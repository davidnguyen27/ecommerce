<script setup lang="ts">
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatConversationView,
  ChatHandoffResponse,
  ChatStatus,
  ChatTurnResponse,
  PRIVACY_POLICY_SLUG,
  type ChatTurnOutcome,
  type ChatUnavailableReason,
} from '@ecommerce/shared'
import { MessageCircle, RotateCcw, Send, UserRound, X } from 'lucide-vue-next'

// Chatbot widget (spec M8 "Web"). Runs only in the browser (the layout wraps it in <ClientOnly> and lazy-loads it), so
// customer page HTML is unchanged and widget errors cannot break the page.
const route = useRoute()

const open = ref(false)
const status = ref<ChatStatus | null>(null)
const entries = ref<ChatEntry[]>([])
const conversationId = ref<string | null>(null)
const draft = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
/** Why the latest turn had no answer; cleared when a later turn answers. */
const unavailable = ref<ChatUnavailableReason | Exclude<ChatTurnOutcome, 'answered'> | null>(null)
const handoffSuggested = ref(false)
const handoffOpen = ref(false)
/** Signed-in customers get the request on their account, without being asked name and email. */
const signedIn = ref(false)
const handoffForm = reactive({ name: '', email: '', message: '' })
const handoffSending = ref(false)
const handoffError = ref<string | null>(null)
const handoffDone = ref<ChatHandoffResponse | null>(null)
const session = useCustomerSession()

async function openHandoff() {
  handoffOpen.value = !handoffOpen.value
  handoffError.value = null
  if (handoffOpen.value) signedIn.value = await session.signedIn()
}

/** The customer confirms the handoff (spec M8 ticket 05): creates a support request with the current conversation. */
async function submitHandoff() {
  if (handoffSending.value) return
  handoffSending.value = true
  handoffError.value = null
  try {
    handoffDone.value = ChatHandoffResponse.parse(
      await session.optionalAuthFetch('/api/chat/handoff', {
        method: 'POST',
        body: {
          conversationId: conversationId.value ?? undefined,
          message: handoffForm.message,
          ...(signedIn.value ? {} : { name: handoffForm.name, email: handoffForm.email }),
        },
      }),
    )
    handoffOpen.value = false
  } catch (err) {
    handoffError.value = apiErrorMessage(err)
  } finally {
    handoffSending.value = false
  }
}

const panel = ref<HTMLElement>()
const list = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()

function readStorage() {
  try {
    return localStorage.getItem(CHAT_STORAGE_KEY)
  } catch {
    return null
  }
}
function writeStorage(id: string | null) {
  try {
    if (id) localStorage.setItem(CHAT_STORAGE_KEY, id)
    else localStorage.removeItem(CHAT_STORAGE_KEY)
  } catch {
    // The browser blocks storage: chat still works on this page, just not after a reload.
  }
}

const notice = computed(() => {
  const reason = unavailable.value ?? (status.value && !status.value.available ? status.value.reason : null)
  return reason ? unavailableText(reason) : null
})

async function scrollToEnd() {
  await nextTick()
  list.value?.scrollTo({ top: list.value.scrollHeight })
}

let loaded = false
/** First open: read the status and reload an unfinished conversation (if still usable). */
async function load() {
  if (loaded) return
  loaded = true
  try {
    status.value = ChatStatus.parse(await $fetch('/api/chat/status'))
  } catch {
    unavailable.value = 'failed'
  }
  const saved = readConversationId(readStorage())
  if (!saved) return
  try {
    const view = ChatConversationView.parse(await $fetch(`/api/chat/conversations/${saved}`))
    if (view.active) {
      conversationId.value = view.id
      entries.value = toEntries(view.messages)
    } else writeStorage(null)
  } catch {
    writeStorage(null)
  }
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await load()
  await scrollToEnd()
  input.value?.focus()
}

function close() {
  open.value = false
}

function restart() {
  conversationId.value = null
  entries.value = []
  unavailable.value = null
  handoffSuggested.value = false
  handoffOpen.value = false
  handoffDone.value = null
  handoffError.value = null
  error.value = null
  writeStorage(null)
  input.value?.focus()
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true
  error.value = null
  const pending = pendingCustomerEntry(content)
  entries.value.push(pending)
  draft.value = ''
  await scrollToEnd()
  try {
    const turn = ChatTurnResponse.parse(
      await $fetch('/api/chat/messages', {
        method: 'POST',
        body: {
          content,
          conversationId: conversationId.value ?? undefined,
          viewingProductSlug: viewingProductSlug(route.path),
        },
      }),
    )
    if (turn.conversationId && turn.conversationId !== conversationId.value) {
      // A new conversation (first time, or the old one silent over 24 h): messages on screen belong to the previous
      // one.
      if (conversationId.value) entries.value = [pending]
      conversationId.value = turn.conversationId
      writeStorage(turn.conversationId)
    }
    if (turn.outcome === 'answered' && turn.reply) {
      entries.value.push({ ...turn.reply, cards: turn.cards })
      unavailable.value = null
      if (turn.handoffSuggested) handoffSuggested.value = true
    } else {
      const asked = entries.value.find((entry) => entry.id === pending.id)
      if (asked) asked.failed = true
      unavailable.value = turn.outcome === 'answered' ? 'failed' : turn.outcome
    }
  } catch (err) {
    // 429 (too many questions, 30 per conversation) or a network error: put the question back in the input to resend.
    entries.value = entries.value.filter((entry) => entry.id !== pending.id)
    draft.value = content
    error.value = apiErrorMessage(err)
  } finally {
    sending.value = false
    await scrollToEnd()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

const availabilityLabel = (card: { inStock: boolean; preorder: boolean }) =>
  card.inStock ? 'Còn hàng' : card.preorder ? 'Nhận đặt trước' : 'Hết hàng'

// Navigating closes the chat on phones (it fills the screen) and keeps it open on desktop.
watch(
  () => route.fullPath,
  () => {
    if (window.matchMedia('(max-width: 639px)').matches) close()
  },
)
</script>

<template>
  <div class="chat-widget">
    <!--
      The Netlify demo has a "Powered by Netlify" badge (fixed iframe at the bottom right, 64px tall, z-index
      2147483645) covering that corner. The button sits above it; the open chat is a dialog, so it covers the badge.
    -->
    <button
      v-if="!open"
      type="button"
      class="fixed bottom-20 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/85"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <MessageCircle class="h-5 w-5" aria-hidden="true" />
      Hỏi trợ lý
    </button>

    <section
      v-else
      ref="panel"
      role="dialog"
      aria-label="Trợ lý tư vấn"
      class="fixed inset-0 z-[2147483646] flex flex-col bg-card sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100vh-2rem))] sm:w-96 sm:rounded-lg sm:border sm:border-border sm:shadow-xl"
      @keydown="onPanelKeydown"
    >
      <header class="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 class="mr-auto font-display text-lg font-semibold">Trợ lý tư vấn</h2>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary"
          aria-label="Bắt đầu lại"
          title="Bắt đầu lại"
          @click="restart"
        >
          <RotateCcw class="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary"
          aria-label="Đóng"
          @click="close"
        >
          <X class="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <p class="border-b border-border bg-secondary px-4 py-2 text-xs leading-relaxed text-muted-foreground">
        {{ status?.privacyNotice }}
        <NuxtLink :to="`/trang/${PRIVACY_POLICY_SLUG}`" class="link">Chính sách bảo mật</NuxtLink>
      </p>

      <div ref="list" class="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        <p v-if="!entries.length" class="text-sm leading-relaxed text-muted-foreground">
          Bạn cần tìm gì? Ví dụ: “túi đi làm dưới 7 triệu”, “giày này size 41 còn không”, “đổi trả trong bao lâu”.
        </p>

        <div v-for="entry in entries" :key="entry.id" :class="entry.role === 'customer' ? 'flex justify-end' : ''">
          <div
            v-if="entry.role === 'customer'"
            class="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            {{ entry.content }}
            <span v-if="entry.failed" class="mt-1 block text-[11px] opacity-80">Chưa có trả lời</span>
          </div>
          <div v-else class="max-w-[92%] space-y-2">
            <!-- renderMarkdown escapes all HTML and blocks javascript: links -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              class="prose-content rounded-lg bg-secondary px-3 py-2 text-sm"
              v-html="renderMarkdown(linkifyShopPaths(entry.content))"
            />
            <ul v-if="entry.cards.length" class="space-y-2">
              <li v-for="card in entry.cards" :key="card.slug">
                <NuxtLink
                  :to="`/san-pham/${card.slug}`"
                  class="flex gap-3 rounded-lg border border-border p-2 transition-colors hover:border-foreground"
                >
                  <img
                    v-if="card.image"
                    :src="imageSrc(card.image, 160)"
                    :alt="card.image.alt"
                    class="h-16 w-16 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                  <span class="min-w-0 text-sm">
                    <span class="block text-xs text-muted-foreground">{{ card.brand.name }}</span>
                    <span class="block truncate font-medium">{{ card.name }}</span>
                    <span class="block tabular-nums">Từ {{ formatVnd(card.fromPrice) }}</span>
                    <span class="block text-xs text-muted-foreground">{{ availabilityLabel(card) }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ul>
            <ul v-else-if="entry.products.length" class="flex flex-wrap gap-2 text-sm">
              <li v-for="product in entry.products" :key="product.slug">
                <NuxtLink :to="`/san-pham/${product.slug}`" class="link">{{ product.name }}</NuxtLink>
              </li>
            </ul>
          </div>
        </div>

        <p v-if="sending" class="text-sm text-muted-foreground">Đang trả lời…</p>
      </div>

      <div class="space-y-2 border-t border-border px-4 py-3">
        <div v-if="notice" class="rounded-md border border-border bg-secondary px-3 py-2 text-sm">
          {{ notice }}
          <!-- The customer layout footer lists the policy pages (spec M8: with policy page links). -->
          <a href="#chinh-sach" class="link" @click="close">Xem các chính sách</a>
        </div>
        <p v-if="error" class="notice-error" role="alert">{{ error }}</p>

        <div v-if="handoffDone" class="notice-ok" role="status">
          Đã gửi yêu cầu #YC{{ handoffDone.requestCode }} cho nhân viên.
          <template v-if="handoffDone.responseTimeNote">{{ handoffDone.responseTimeNote }}</template>
          <NuxtLink v-if="handoffDone.link" :to="handoffDone.link" class="link">Xem yêu cầu</NuxtLink>
          <template v-else>Bạn sẽ nhận email kèm link theo dõi.</template>
        </div>

        <form
          v-if="handoffOpen"
          class="space-y-2 rounded-md border border-border p-3"
          aria-label="Gửi cho nhân viên"
          @submit.prevent="submitHandoff"
        >
          <p class="text-sm leading-relaxed">
            Nhân viên sẽ đọc cuộc trò chuyện này và trả lời
            {{ signedIn ? 'trong trang tài khoản của bạn' : 'qua email' }}.
          </p>
          <template v-if="!signedIn">
            <label class="field">
              Tên
              <input v-model="handoffForm.name" class="field-input" autocomplete="name" required maxlength="100" />
            </label>
            <label class="field">
              Email
              <input v-model="handoffForm.email" class="field-input" type="email" autocomplete="email" required />
            </label>
          </template>
          <label class="field">
            Lời nhắn {{ conversationId ? '(không bắt buộc)' : '' }}
            <textarea
              v-model="handoffForm.message"
              rows="2"
              maxlength="2000"
              :required="!conversationId"
              class="field-input h-auto py-2"
            />
          </label>
          <p v-if="handoffError" class="notice-error" role="alert">{{ handoffError }}</p>
          <button type="submit" class="btn-primary h-10 w-full" :disabled="handoffSending">
            {{ handoffSending ? 'Đang gửi…' : 'Gửi cho nhân viên' }}
          </button>
        </form>

        <button
          v-if="!handoffDone"
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors"
          :class="
            handoffSuggested || notice
              ? 'border-foreground bg-foreground text-background hover:bg-foreground/85'
              : 'border-border hover:border-foreground'
          "
          :aria-expanded="handoffOpen"
          @click="openHandoff"
        >
          <UserRound class="h-4 w-4" aria-hidden="true" />
          Gặp nhân viên
        </button>

        <form class="flex items-end gap-2" @submit.prevent="send">
          <label class="sr-only" for="chat-input">Câu hỏi</label>
          <textarea
            id="chat-input"
            ref="input"
            v-model="draft"
            rows="2"
            :maxlength="CHAT_MESSAGE_MAX_LENGTH"
            placeholder="Nhập câu hỏi…"
            class="min-h-[2.75rem] flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground sm:text-sm"
            @keydown="onKeydown"
          />
          <button
            type="submit"
            class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="sending || !draft.trim()"
            aria-label="Gửi"
          >
            <Send class="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
        <p class="text-right text-[11px] tabular-nums text-muted-foreground">
          {{ draft.length }}/{{ CHAT_MESSAGE_MAX_LENGTH }}
        </p>
      </div>
    </section>
  </div>
</template>
