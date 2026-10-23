type SeoOptions = {
  title: MaybeRefOrGetter<string>
  description: MaybeRefOrGetter<string>
  /** Đường dẫn chuẩn của trang; mặc định là đường dẫn hiện tại bỏ query (`?sku=`, `utm_*`, …). */
  canonicalPath?: MaybeRefOrGetter<string>
  image?: MaybeRefOrGetter<string | undefined>
  /** Trang trùng nội dung với trang khác (kết quả tìm kiếm, URL có bộ lọc) hoặc riêng của từng khách. */
  noindex?: MaybeRefOrGetter<boolean>
}

/** Title, description, canonical và Open Graph cho trang khách. URL tuyệt đối dựng từ `siteUrl`. */
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
    // `follow` để máy tìm kiếm vẫn đi theo link tới trang sản phẩm, danh mục.
    robots: () => (toValue(options.noindex) ? 'noindex, follow' : undefined),
  })
  useHead({ link: [{ rel: 'canonical', href: url }] })
}

/** Đổi đường dẫn (hoặc URL ảnh đã tuyệt đối) thành URL tuyệt đối trên website. */
export function useAbsoluteUrl() {
  const { siteUrl } = useRuntimeConfig().public
  return (path: string) => new URL(path, siteUrl).href
}
