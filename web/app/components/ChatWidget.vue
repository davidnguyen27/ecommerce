<script setup lang="ts">
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatConversationView,
  ChatStatus,
  ChatTurnResponse,
  PRIVACY_POLICY_SLUG,
  type ChatTurnOutcome,
  type ChatUnavailableReason,
} from '@ecommerce/shared'
import { MessageCircle, RotateCcw, Send, UserRound, X } from 'lucide-vue-next'

// Khung chat với chatbot (spec M8 "Web"). Chỉ chạy ở trình duyệt (layout bọc trong <ClientOnly> và tải lazy), nên
// HTML trang khách không đổi và lỗi của khung chat không làm hỏng trang.
const route = useRoute()

const open = ref(false)
const status = ref<ChatStatus | null>(null)
const entries = ref<ChatEntry[]>([])
const conversationId = ref<string | null>(null)
const draft = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
/** Lý do lượt gần nhất không có trả lời; xóa khi lượt sau trả lời được. */
const unavailable = ref<ChatUnavailableReason | Exclude<ChatTurnOutcome, 'answered'> | null>(null)
const handoffSuggested = ref(false)
const staffInfoOpen = ref(false)

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
    // Trình duyệt chặn lưu trữ: vẫn chat được trong trang này, chỉ không còn sau khi tải lại.
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
/** Lần mở đầu: đọc trạng thái và nạp lại cuộc đang dở (nếu còn dùng được). */
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
  staffInfoOpen.value = false
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
      // Cuộc mới (lần đầu, hay cuộc cũ đã im quá 24 giờ): tin cũ trên màn hình thuộc cuộc trước.
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
    // 429 (quá nhiều câu hỏi, cuộc đủ 30 câu) hay lỗi mạng: trả câu hỏi về ô nhập để khách gửi lại.
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

// Chuyển trang thì đóng khung chat trên điện thoại (khung chiếm cả màn hình), giữ mở trên máy tính.
watch(
  () => route.fullPath,
  () => {
    if (window.matchMedia('(max-width: 639px)').matches) close()
  },
)
</script>

<template>
  <div class="chat-widget">
    <button
      v-if="!open"
      type="button"
      class="fixed bottom-4 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/85"
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
      class="fixed inset-0 z-50 flex flex-col bg-card sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100vh-2rem))] sm:w-96 sm:rounded-lg sm:border sm:border-border sm:shadow-xl"
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
            <!-- renderMarkdown thoát mọi HTML và chặn link javascript: -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              class="prose-content rounded-lg bg-secondary px-3 py-2 text-sm"
              v-html="renderMarkdown(entry.content)"
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
        </div>
        <p v-if="error" class="notice-error" role="alert">{{ error }}</p>

        <!-- Form chuyển nhân viên làm ở ticket 05; tạm chỉ đường gửi yêu cầu hỗ trợ đang có. -->
        <div v-if="staffInfoOpen" class="rounded-md border border-border px-3 py-2 text-sm leading-relaxed">
          Bạn có thể gửi yêu cầu hỗ trợ từ trang
          <NuxtLink to="/tai-khoan" class="link">tài khoản</NuxtLink> hoặc từ link tra cứu đơn trong email.
        </div>
        <button
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors"
          :class="
            handoffSuggested || notice
              ? 'border-foreground bg-foreground text-background hover:bg-foreground/85'
              : 'border-border hover:border-foreground'
          "
          :aria-expanded="staffInfoOpen"
          @click="staffInfoOpen = !staffInfoOpen"
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
