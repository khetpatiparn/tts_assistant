# Spec — แฮชแท็กที่ต้องลง (Required hashtag) ของสินค้าใน Showcase

Status: ready-for-agent

ที่มา: grilling 2026-10-10 (คำว่า Required hashtag ใน `CONTEXT.md`) · งานวิจัยประกอบการตัดสินใจ: `docs/research/2026-10-10-campaign-flag-for-analysis.md`

## Problem Statement

ผมทำคลิปขายสินค้า affiliate และเข้าร่วมกิจกรรมของ TikTok (เช่น AI Creator Camp) กิจกรรมกำหนดว่าตอนปักตะกร้าต้องลงแฮชแท็กต่อท้าย (เช่น `#trendyselected`) ถ้าไม่ลง บางครั้งสินค้านั้นจะไม่นับเป็นสินค้ากิจกรรมของ TikTok ทำให้ผมเสียโบนัสหรือคะแนน

ปัญหาคือ Angle ไม่รู้ว่าสินค้าแต่ละตัวต้องลงแฮชแท็กอะไร ผมต้องจำเองหรือกลับไปเปิดกติกากิจกรรมทุกครั้งที่ปักตะกร้า สินค้าบางตัวต้องลงแฮชแท็ก บางตัวไม่ต้อง บางตัวอยู่ในกิจกรรมแต่ไม่ต้องลง และบางครั้งเป็นสินค้าอะไรก็ได้ที่กิจกรรมแค่ขอให้ลงแฮชแท็กตามจำนวนคลิป ผมจำไม่ไหวและพลาดได้

## Solution

ที่หน้า `/showcase` ผมติ๊กเลือกสินค้าหลายตัว พิมพ์แฮชแท็กที่ต้องลงหนึ่งครั้ง แล้วกดใส่ให้ทุกตัวที่เลือกพร้อมกัน แฮชแท็กนั้นกลายเป็นป้ายติดกับสินค้า และโชว์อีกครั้งที่หัวงานใน `/flow` และหน้า entry ซึ่งเป็นที่เดียวกับที่ Product ID ถูกโชว์อยู่แล้ว ตอนปักตะกร้าผมเห็นทันทีว่าต้องลง `#` อะไร หรือไม่เห็นป้ายเลยแปลว่าไม่ต้องลง

ผมแก้พิมพ์ผิดได้โดยใส่ใหม่ทับ และมีปุ่มลบแยกต่างหาก Showcase Scanner ไม่เกี่ยวข้อง จึงไม่ต้องแก้ extension หรือ protocol ที่แจกคนอื่น และปุ่ม "สแกนสินค้าใหม่ → ส่ง" ในป๊อปอัปทำงานเหมือนเดิม

## User Stories

1. As a creator, I want to tick several products on the Showcase page and type one required hashtag for all of them, so that I do not repeat the same typing for 20 new products.
2. As a creator, I want a "select all in this tab" button, so that I can tag all new products in "ยังไม่เริ่ม" with one click.
3. As a creator, I want to deselect everything with one click, so that I can start a new selection quickly.
4. As a creator, I want to see how many products I have selected, so that I do not tag the wrong number of products.
5. As a creator, I want to type the hashtag with or without the `#` sign, so that a forgotten `#` does not break the tag.
6. As a creator, I want to type several hashtags separated by spaces or commas, so that a product that needs two hashtags gets both in one action.
7. As a creator, I want duplicate hashtags in my input removed (ignoring upper/lower case), so that a typo-like repeat does not create two copies.
8. As a creator, I want the casing I typed last to be shown, so that the badge looks like what I meant.
9. As a creator, I want applying a hashtag to replace the old hashtags of the selected products, so that fixing a typo is just typing the right one again.
10. As a creator, I want a separate "remove hashtag" button, so that removing is a clear, deliberate action and never a side effect of an empty input.
11. As a creator, I want an empty input with the apply button to do nothing and tell me why, so that I do not wipe hashtags by accident.
12. As a creator, I want the input to clear after a successful apply, so that a leftover hashtag is never applied to the next selection by mistake.
13. As a creator, I want to pick from hashtags I typed before, so that I do not retype `#trendyselected` every time.
14. As a creator, I want those suggestions to come from what products already have, so that there is no extra list to maintain.
15. As a creator, I want to apply hashtags in every tab (ยังไม่เริ่ม, กำลังทำ, โพสต์แล้ว, ไม่ทำแล้ว), so that I can fix or add a hashtag even after the clip is posted.
16. As a creator, I want the selection to reset when I switch tabs, so that I never tag products I cannot see.
17. As a creator, I want each Showcase row to show its required hashtags as a badge, so that I can see at a glance which products have one.
18. As a creator, I want products with no hashtag to show no badge, so that "no badge" clearly means "nothing to append".
19. As a creator, I want the same badge in the header of a job in `/flow`, so that I see the hashtag when I am about to pin the cart.
20. As a creator, I want the same badge on the entry page, so that I see it where I finalize and post the clip.
21. As a creator, I want a copy button on the badge in `/flow` and the entry page, so that I can paste all hashtags into the caption without retyping.
22. As a creator, I want entries that did not come from Showcase to show nothing, so that the page is not cluttered with empty fields.
23. As a creator, I want a hashtag I set to survive when I send the same product again from the scanner, so that a re-scan never wipes my work.
24. As a creator, I want a product sent again from the scanner to keep the hashtag it already has, so that scanning stays safe.
25. As a creator, I want the page to tell me how many products were updated, so that I know the action worked.
26. As a creator, I want a clear error if the save fails, so that I do not believe a product is tagged when it is not.
27. As a creator, I want to do all of this on my phone, so that I can tag products without the computer.
28. As a creator, I want the buttons and checkboxes to be easy to tap on a phone, so that I do not select the wrong row.
29. As a creator, I want the desktop (1440px) layout of the Showcase page to stay as it is, so that my daily workflow does not change.
30. As a creator, I want the Showcase Scanner to stay unaware of hashtags, so that the extension I share with other people does not change.
31. As a creator, I want the product hashtags to follow the product and not any one batch row, so that duplicated rows of the same product always agree.
32. As a creator, I want dismissed ("ไม่ทำแล้ว") products to keep their hashtag when I restore them, so that I do not retype after changing my mind.
33. As the owner of the system, I want the glossary term "Required hashtag" used in the UI wording, so that the screen and the documents agree.
34. As the owner of the system, I want old products that are not in `/showcase` (before the tracking start date) to stay untouched, so that the earlier decision to start counting fresh is kept.

## Implementation Decisions

- **New domain concept: Required hashtag (แฮชแท็กที่ต้องลง)** — defined in `CONTEXT.md`. It belongs to a product (identified by the Showcase product ID), not to a clip, an entry, or a batch row. The system does NOT record "this product belongs to a campaign" — only which hashtags to append. This was decided because the real data cannot support analysis of that distinction (see research note).
- **Storage:** a new table keyed uniquely by the Showcase product ID holding the list of hashtags. It is separate from the per-batch candidate rows, because sending the same product again creates new rows and a column on those rows would be lost or inconsistent. One additive migration; no change to existing columns. The user runs the migration himself (see Further Notes).
- **Normalization (one pure function, single source of truth):** split input on whitespace and commas; add a leading `#` when missing; drop empty items and a lone `#`; remove duplicates comparing case-insensitively, keeping the casing typed last; keep the order typed. Input that normalizes to nothing is rejected with a plain Thai message. Reasonable upper bounds on count and length protect the page; exceeding them is rejected with a message.
- **Apply = replace, Remove = explicit.** Applying sets the product's list to exactly the normalized input. Removing deletes the product's list. An empty input never removes anything.
- **Bulk action:** one server action takes a list of product IDs and the text, applies to all in one transaction, ignores IDs that are not Showcase products, and returns the number updated. It revalidates only the routes it affects: the Showcase page, the flow page, and the entry pages.
- **Showcase list UI:** a checkbox on each row, a "select all in this tab" and a "clear selection" control, a selection count, a text input with suggestions, an "ใส่แฮชแท็ก" button and a separate "ลบแฮชแท็ก" button. Selection is client-only and resets when the tab changes. The controls work on all four tabs.
- **Suggestions** are computed from hashtags currently stored on products (most used first). No separate list or table.
- **Display:** the Showcase item data carries its hashtags so the row can render a badge. The flow job header and the entry page show the same badge beside the Product ID, found through the same link from entry to Showcase product that the Product ID already uses. The badge on those two pages has a copy button that copies all hashtags joined by a space, matching how the Product ID copy button behaves.
- **No change to the Showcase Scanner, its extension, the destination-link protocol `showcase-scanner/1`, the scanner route, or the import path.** The import never reads or writes hashtags, so re-scans cannot overwrite them.
- **No change to the post text file written to the TTS folder.** The owner does not use it; the TTS folder export keeps its current content.
- **No change to the entry's own `hashtags` field (caption hashtags).** Copying a required hashtag into it is a manual user action.
- **UI rules of the repo apply:** color tokens only, text scale only, Thai line-height, buttons and checkboxes at least 44px tall below `lg:`, no hover-only information, tap targets for icons at least 24px, and the `lg:`/1440px layout unchanged.
- **Docs:** update the Showcase agent doc with the new concept, where it is stored, and the rule that the import never touches it.
- No ADR is needed: the storage choice is easy to reverse and not surprising.

## Testing Decisions

- **A good test checks external behavior only:** given this input text and this existing state, what list comes out; given these items and this hashtag map, what each row and each entry shows. It does not look at how the table or action is built.
- **One seam: the pure hashtag logic**, tested by a new `scripts/check-required-hashtag.mjs` in the same style as `scripts/check-showcase.mjs` (compile the TypeScript module to a temp folder, run assertions, print PASS/FAIL, exit non-zero on failure). Cases to cover: adding `#`, splitting on spaces and commas, duplicates in different casing, keeping the last typed casing, empty and lone `#` input rejected, count/length bounds, replace vs remove semantics, suggestion ordering, and attaching hashtags to Showcase items and to entries through the Showcase link (including entries with no link).
- **Extend the existing Showcase check** so rows still sort, collapse and filter the same with hashtags present (no regression in `buildShowcaseItems` behavior).
- **Prior art:** `scripts/check-showcase.mjs`, `scripts/check-showcase-import.mjs`, `scripts/check-flow-jobs.mjs`.
- **Not unit-tested:** the thin database read/write layer and the server action wiring. They are verified by hand on a copy database (`dev-test.db`, port 3001, never the live `dev.db`) and by `node scripts/shot.mjs` at 390 / 820 / 1440px with touch enabled below 1024px, which is already a mandatory checkpoint for any UI change.
- Always run `npx tsc --noEmit` and `npm run lint`. Run `npm run build` only at the end and only if port 3000 is free (ask the user otherwise).

## Out of Scope

- Any change to the Showcase Scanner extension, its popup, its protocol, or its example destinations.
- Recording whether a product is "a campaign product" versus "any product that just needs the hashtag" (not enough clips to analyze; see research note for the conditions to revisit).
- Campaign names, a table mapping campaign names to hashtags, or per-campaign settings.
- Reading the "TikTok bonus" columns from order files (a separate idea from the research note).
- Filtering the Showcase list by hashtag.
- Auto-adding required hashtags to an entry's caption hashtags.
- Changing or rewriting the post text file in the TTS folder.
- Hashtags for the earlier 197 products before 29 Sep 2026 that are not shown in `/showcase`, and for products found on the "หาสินค้า" ranking page.
- Fetching the hashtags actually posted on past clips from TikTok.

## Further Notes

- **The user must run the migration himself:** `stop.bat`, then `npx prisma migrate deploy` and `npx prisma generate` at the repo root, using `! <command>`. `lib/generated/` is git-ignored, so after `prisma generate` the production build must be forced by deleting `.next` (see the build-fingerprint note in `CLAUDE.md`). Agents must not run commands that modify the live `dev.db`.
- Develop and check against a copy: `cp dev.db dev-test.db`, `node scripts/enable-wal.mjs dev-test.db`, then run the dev server with `NEXT_DIST_DIR=.next-dev`, `DATABASE_URL="file:./dev-test.db"` on port 3001. Any `DELETE` must have a specific `WHERE`.
- Check `git diff tsconfig.json` before committing and restore it if Next changed it.
- The copy button on the badge for `/flow` and the entry page is an assumption that matches how the Product ID is handled; the user did not object when it was described. It is cheap to drop.
- Reopen the "campaign product" question only if: the mandatory quota ends, the TikTok bonus exceeds about 15% of income, the campaign scores products differently by type, or output reaches about 30 clips per week. If it does, the cheapest route is a single nullable tick on the Showcase page, not a second field in the extension.
