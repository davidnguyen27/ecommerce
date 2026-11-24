type SeoOptions = {
  title: MaybeRefOrGetter<string>
  description: MaybeRefOrGetter<string>
  /** The page's canonical path; defaults to the current path without query (`?sku=`, `utm_*`, …). */
  canonicalPath?: MaybeRefOrGetter<string>
  image?: MaybeRefOrGetter<string | undefined>
  /** A page duplicating another (search results, filtered URLs) or specific to one customer. */
  noindex?: MaybeRefOrGetter<boolean>
}

/** Title, description, canonical and Open Graph for customer pages. Absolute URLs are built from `siteUrl`. */
export function useSeo(options: SeoOptions) {
  const route = useRoute()
  const absolute = useAbsoluteUrl()
  const url = computed(() => absolute(toValue(options.canonicalPath) ?? route.path))
  const image = computed(() => {
    const src = toValue(options.image)
    return src ? absolute(src) : undefined
  })

  useSeoMeta({
    title: options.title,
    description: options.description,
    ogTitle: options.title,
    ogDescription: options.description,
    ogUrl: url,
    ogType: 'website',
    ogImage: image,
    // `follow` so search engines still follow links to product and category pages.
    robots: () => (toValue(options.noindex) ? 'noindex, follow' : undefined),
  })
  useHead({ link: [{ rel: 'canonical', href: url }] })
}

/** Turns a path (or an already absolute image URL) into an absolute website URL. */
export function useAbsoluteUrl() {
  const { siteUrl } = useRuntimeConfig().public
  return (path: string) => new URL(path, siteUrl).href
}
