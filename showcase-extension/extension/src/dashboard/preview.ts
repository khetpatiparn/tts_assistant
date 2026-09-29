import type { NormalizedProduct } from '../domain/product.js'
import { clearChildren, setText } from './dom.js'

/** UI05 — หน้าละไม่กี่สิบแถวพอ ไม่ต้องสร้าง DOM ของทั้ง 5,000 รายการพร้อมกัน */
export const DEFAULT_PAGE_SIZE = 50

export function totalPages(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / pageSize))
}

export interface RenderPreviewOptions {
  readonly page: number
  readonly pageSize?: number
}

/**
 * แสดงสินค้าหนึ่งหน้าของ local pagination — เรียกซ้ำได้ทุกครั้งที่เปลี่ยนหน้า/filter/selection
 * ใช้ text-only sink จาก dom.ts เท่านั้น (V11/UT09) และใช้ native <input type=checkbox> ในกล่อง
 * <label> เพื่อให้ focus/คีย์บอร์ด และ accessible name ทำงานได้โดยไม่ต้องเขียน ARIA เอง (UI04)
 */
export function renderPreviewPage(
  container: Element,
  products: readonly NormalizedProduct[],
  selected: ReadonlySet<string>,
  options: RenderPreviewOptions,
  onToggle: (productId: string) => void,
): void {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const start = options.page * pageSize
  const windowProducts = products.slice(start, start + pageSize)
  const doc = container.ownerDocument

  clearChildren(container)

  for (const product of windowProducts) {
    const row = doc.createElement('div')
    row.className = 'product-row'

    const label = doc.createElement('label')
    const checkbox = doc.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selected.has(product.productId)
    checkbox.dataset['productId'] = product.productId
    checkbox.addEventListener('change', () => {
      onToggle(product.productId)
    })

    const titleSpan = doc.createElement('span')
    titleSpan.className = 'product-title'
    setText(titleSpan, product.title)

    label.append(checkbox, titleSpan)

    const priceSpan = doc.createElement('span')
    priceSpan.className = 'product-price'
    setText(priceSpan, product.priceDisplay ?? '(ไม่ทราบราคา)')

    const shopSpan = doc.createElement('span')
    shopSpan.className = 'product-shop'
    setText(shopSpan, product.shopName ?? '(ไม่ทราบร้าน)')

    const imageSpan = doc.createElement('span')
    imageSpan.className = 'product-image'
    // preview เป็นตารางรายการยาว (อาจมีสินค้าเป็นร้อย) โชว์แค่รูปแรกเป็น thumbnail เป็นค่าเริ่มต้น —
    // ไฟล์ export มี imageUrls ครบทุกรูปอยู่แล้ว ตรงนี้แค่ไม่โชว์ทั้งหมดพร้อมกันตั้งแต่แรกเพื่อความไว
    // กดที่ thumbnail เพื่อขยายดูรูปที่เหลือทั้งหมดของสินค้าชิ้นนั้น (ใช้ native <button> ให้กดด้วย
    // คีย์บอร์ดได้ และ toggle ผ่าน `hidden` ตรง ๆ ไม่ต้องมี state แยกนอก DOM)
    const thumbnail = product.imageUrls[0]
    // gallery ต้องเป็นลูกของแถว (grid) ไม่ใช่ของ imageSpan — ถ้าอยู่ใน imageSpan มันจะขยายคอลัมน์รูปที่เป็น auto
    // จนคอลัมน์ชื่อสินค้า (1fr) เหลือกว้างตัวอักษรเดียว ชื่อเรียงลงเป็นแนวตั้ง (เจอจริง 2026-09-29) · CSS
    // `.product-image-gallery { grid-column: 1 / -1 }` มีผลเฉพาะตอนเป็นลูกตรงของ grid เท่านั้น
    let gallery: HTMLElement | null = null
    if (thumbnail === undefined) {
      setText(imageSpan, '(ไม่มีรูปภาพ)')
    } else {
      const toggleButton = doc.createElement('button')
      toggleButton.type = 'button'
      toggleButton.className = 'product-image-toggle'
      const img = doc.createElement('img')
      img.src = thumbnail
      img.alt = product.title
      toggleButton.append(img)
      imageSpan.append(toggleButton)

      const extraCount = product.imageUrls.length - 1
      if (extraCount > 0) {
        const galleryEl = doc.createElement('div')
        galleryEl.className = 'product-image-gallery'
        galleryEl.hidden = true
        for (const url of product.imageUrls) {
          const galleryImg = doc.createElement('img')
          galleryImg.src = url
          galleryImg.alt = product.title
          galleryEl.append(galleryImg)
        }

        const countBadge = doc.createElement('span')
        countBadge.className = 'product-image-count'
        setText(countBadge, `+${String(extraCount)}`)
        toggleButton.append(countBadge)

        toggleButton.setAttribute('aria-expanded', 'false')
        toggleButton.addEventListener('click', () => {
          galleryEl.hidden = !galleryEl.hidden
          toggleButton.setAttribute('aria-expanded', String(!galleryEl.hidden))
        })
        gallery = galleryEl
      }
    }

    row.append(label, priceSpan, shopSpan, imageSpan)
    if (gallery !== null) row.append(gallery)
    container.append(row)
  }
}
