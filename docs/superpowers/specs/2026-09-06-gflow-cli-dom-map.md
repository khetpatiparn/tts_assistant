# gflow-cli — DOM map of how it drives Google Flow for IMAGE generation

Source: https://github.com/ffroliva/gflow-cli (default branch is `develop`, not `main`; latest tag v0.68.0, 2026-09-05).
Research date: 2026-09-06. All excerpts fetched from `raw.githubusercontent.com/ffroliva/gflow-cli/<ref>/<path>`.

**Method caveat.** The two core Playwright modules are huge (`ui_automation.py` 178 KB, `ui_automation_video.py` 196 KB) and WebFetch truncates them roughly at the 2/3 mark. Where the `develop` copy was truncated I pulled the same method from an older tag (v0.10.0 / v0.20.0 / v0.30.0) and say so explicitly. Anything I could not read is marked **[NOT VERIFIED]**. No selectors below are invented — every string is quoted from a file.

---

## 0. Big picture (read this first)

- gflow does **not** call a public API. For images it launches a **headed, persistent-context system Chrome** via Playwright, opens the Flow editor, clicks the real UI, and **captures the app's own XHR reply** (`.../flowMedia:batchGenerateImages`) with `page.on("response")` to learn the result media IDs / signed URLs. It then downloads the bytes with `page.request.get(fife_url)`.
- Three pure-HTTP transports were tried and shelved (`api/transports/experimental/{evaluate_fetch,bearer,sapisidhash}.py`): "Tokens rotate too aggressively; rate-limited within minutes" (bearer) and "sapisidhash … Works for read endpoints; rejected for any mutation endpoint" (docs/ARCHITECTURE.md).
- Two Flow "cohorts" exist on labs.google: **classic** composer (crop_* settings dropdown, network-captured results) and **agentic** chat composer (DOM-scraped results, settings written into the prompt sentence). Since v0.62.0 `--ui-mode auto` forces classic for images.
- Since ~2026-09-03 Google is moving accounts to **flow.google.com** (Angular Material, `mat-icon`, `batchexecute` wire). **Image generation is NOT ported there** — it exits 36. Only t2v and local-frame i2v work on the migrated host (see §7).

Module map (all under `src/gflow_cli/`):

| File | Role |
|---|---|
| `api/transports/ui_automation.py` | `UiAutomationTransport` — image path: launch, enter editor, overlays, image mode, settings, prompt, submit, response capture |
| `api/transports/ui_automation_video.py` | `VideoGenerationMixin` — shared selector cascade probe, media dialog upload (`_upload_via_open_dialog`), library picker, video paths |
| `api/transports/mode_control.py` | classic↔agent toggle, `CROP_SELECTORS`, sidebar close |
| `api/transports/drivers/{base,classic,agentic,factory}.py` | cohort detection + per-cohort driver Strategy |
| `api/transports/_common.py` | `flow_host_kind`, `await_url_settled`, `extract_project_id`, `count_visible` |
| `api/transports/migrated_composer.py` | flow.google.com driver (video only) |
| `api/client.py` | `FlowApiClient` — owns Playwright launch for the shared-page path, locale resolution, reCAPTCHA minting, `download_image` |
| `api/routes.py` | URL builders |
| `api/recaptcha.py` | `grecaptcha.enterprise.execute` token minting |
| `auth/{real_chrome,internal_chromium,verification,factory}.py` | `gflow auth login` |
| `browser_manager.py` | Chrome discovery, `channel_for_profile` |
| `flow_selectors/{model,registry,grading}.py` | selector registry + nightly drift probe |
| `errors.py` | typed errors + exit code map |
| `image_batch.py` | multi-prompt loop + jitter |

---

## 1. URLs and project open/create

**`src/gflow_cli/api/transports/ui_automation.py` (develop):**
```python
FLOW_URL = "https://labs.google/fx/tools/flow?hl=en"
_PROJECT_URL_FRAGMENT = "/project/"
_VIEWPORT = {"width": 1920, "height": 1080}
```
(v0.10.0 had `_VIEWPORT = {"width": 1280, "height": 800}`; it was raised because "below this, Flow crosses its responsive breakpoint and the selectors drift" — `flow_selectors/model.py`, `MIN_VIEWPORT = (1920, 1080)`.)

**`src/gflow_cli/api/routes.py` (develop):**
```python
FLOW_API_BASE = "https://aisandbox-pa.googleapis.com/v1"
LABS_TRPC_BASE = "https://labs.google/fx/api/trpc"
LABS_FX_BASE = "https://labs.google/fx"
EDITOR_BOOTSTRAP_URL = "https://labs.google/fx/tools/flow?hl=en"
UPLOAD_IMAGE = f"{FLOW_API_BASE}/flow/uploadImage"

def project_editor_url(locale: str | None, project_id: str) -> str:
    """Pattern: ``https://labs.google/fx/{seg}/tools/flow/project/{project_id}``,
    or the bare ``.../tools/flow/project/{project_id}`` when *locale* is unknown."""
    ...
    if segment is None:
        return f"{LABS_FX_BASE}/tools/flow/project/{project_id}"
    return f"{LABS_FX_BASE}/{segment}/tools/flow/project/{project_id}"

def media_download_url(name: str) -> str:
    """Build the redirect URL for an asset name (UUID)."""
    return f"{LABS_BASE}/fx/api/trpc/media.getMediaUrlRedirect?name={name}"

def batch_generate_images_url(project_id: str) -> str:
    return f"{FLOW_API_BASE}/projects/{project_id}/flowMedia:batchGenerateImages"
```
Project creation via tRPC is `project.createProject`; via UI it is the "+ New project" button (below). Project id regex: "alphanumeric + hyphen, 1-128 chars".

**Locale redirect is real and account-driven.** Flow redirects `labs.google/fx/tools/flow` → `labs.google/fx/<locale>/tools/flow` *after* `goto` returns, for some accounts only. gflow learns the account locale from where Flow lands at bootstrap (`client._resolve_account_locale`, falling back to `<html lang>` polled for up to 4 s because "Flow serves `en` shell, rewrites `lang` during hydration" — CHANGELOG 0.66.3), then waits for it:

**`src/gflow_cli/api/transports/_common.py` (develop):**
```python
URL_SETTLE_TIMEOUT_MS: float = 4_000.0
FLOW_LOCALISED_URL_RE = routes.LOCALE_SEGMENT_RE

async def await_url_settled(page: Any) -> str | None:
    """Wait for Flow's locale redirect to land; return the settled URL or ``None``."""
    ...
    if current and FLOW_LOCALISED_URL_RE.match(current):
        return current
    if flow_host_kind(current) == "migrated":
        return None
    try:
        await page.wait_for_url(FLOW_LOCALISED_URL_RE, timeout=URL_SETTLE_TIMEOUT_MS)
        return str(page.url)
    except Exception as exc:
        log.info("transport.url_settle_gave_up", ...)
        return None

def extract_project_id(url: str) -> str | None:
    if PROJECT_URL_FRAGMENT not in url:
        return None
    return url.split(PROJECT_URL_FRAGMENT)[1].split("?", maxsplit=1)[0]
```

**Entering the editor — `UiAutomationTransport._enter_editor` (develop, verbatim core):**
```python
NEW_PROJECT_SELECTORS = (
    "button:has(i.google-symbols:text('add_2'))",
    "button:has(i:text('add_2'))",
    "[role='button']:has(i.google-symbols:text('add_2'))",
    r"button:text-matches('^\+\s+\S+$', 'i')",
    "button:has-text('New project')",
    "button:has-text('Novo projeto')",
    "button:has-text('Nuevo proyecto')",
    "button:has-text('Nouveau projet')",
    "button:has-text('Neues Projekt')",
    "button:has-text('Nuovo progetto')",
    "button:has-text('Nieuw project')",
    "button:has-text('新しいプロジェクト')",
    "button:has-text('新建项目')",
    "button:has-text('새 프로젝트')",
    "button:has-text('Nowy projekt')",
    "button:has-text('Новый проект')",
    "button:has-text('Yeni proje')",
    "button:has-text('Proyek baru')",
)

async def _enter_editor(self, page, out_dir=None, *, project_id=None, project_name=None):
    if project_id:
        url = routes.project_editor_url(self._account_locale, project_id)
        await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        before = page.url
        settled = await self._settle_if_redirecting(page)
        ...
        await self._dismiss_blocking_overlays(page, out_dir)
        await self._require_unblocked(page, out_dir, epoch="project editor")
        return

    if _PROJECT_URL_FRAGMENT in page.url:
        # Flow's PWA restores the last-visited project URL on next browser
        # launch (persistent context). ... Navigate back to the gallery first
        # Do NOT use wait_until="networkidle" — PWAs re-render incrementally
        await page.goto(FLOW_URL, timeout=45_000)
        await self._settle_if_redirecting(page)
        await self._bypass_onboarding(page)

    await page.wait_for_timeout(3000)
    await self._dismiss_blocking_overlays(page, out_dir)
    await self._bypass_onboarding(page)
    await self._require_unblocked(page, out_dir, epoch="gallery")
    for selector in NEW_PROJECT_SELECTORS:
        try:
            loc = page.locator(selector).first
            await loc.wait_for(state="visible", timeout=5000)
            await loc.click(timeout=5000)
            try:
                await page.wait_for_url(lambda url: _PROJECT_URL_FRAGMENT in url, timeout=15_000)
                return
            except Exception:
                log.warning("ui_automation.new_project_click_did_not_navigate", selector=selector)
        except Exception:
            continue
    shot_path = await _capture_debug_screenshot(page, out_dir, "debug_new_project.png")
    raise RuntimeError(f"Could not find 'New project' CTA on Flow gallery. URL: {page.url}...")
```
Key facts: a fresh project is created by clicking the `add_2` icon button on the gallery and waiting for `/project/` in the URL (15 s). With `--project <id>` it navigates straight to the editor URL. On `flow.google.com` the project URL is simply `https://flow.google.com/project/{project_id}` (`migrated_composer.py`: `MIGRATED_PROJECT_URL`).

---

## 2. Chrome launch

Two distinct launch sites; both are **persistent context, headed, `channel="chrome"` when the profile was logged in with real Chrome**.

**Standalone transport path — `UiAutomationTransport.setup` (develop, verbatim):**
```python
self._lease = await ProfileLease(profile_dir).aacquire()
locale_env = os.getenv("GFLOW_CLI_LOCALE", "en-US")
channel = channel_for_profile(profile_dir)
ensure_profile_engine_compatible(profile_dir, channel)
ctx = await pw.chromium.launch_persistent_context(
    str(profile_dir),
    headless=False,
    viewport=cast("ViewportSize", _VIEWPORT),   # 1920x1080
    locale=locale_env,
    channel=channel,                             # "chrome" or None
    args=[
        "--disable-blink-features=AutomationControlled",
        "--password-store=basic",
        "--disable-dev-shm-usage",
    ],
)
# Hide the automation flag so reCAPTCHA Enterprise doesn't score
# the session as a bot — navigator.webdriver=true causes low-score
# tokens and HTTP 403 on batchGenerateImages.
await ctx.add_init_script(
    "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})",
)
page = ctx.pages[0] if ctx.pages else await ctx.new_page()
await page.goto(FLOW_URL, wait_until="networkidle", timeout=45_000)
```

**Shared-page path — `src/gflow_cli/api/client.py` (`FlowApiClient`, develop, summarized by fetch; kwargs list is verbatim):**
- `launch_persistent_context(**kwargs)` with `user_data_dir=<profile dir>`, `headless` (default `False`), `channel` → `"chrome"` or `None`, `viewport={"width":1280,"height":720}` **[NOTE: client uses 1280×720 while the transport uses 1920×1080 — this discrepancy is as-reported by the fetch, treat as uncertain]**, `locale="en-US"`, `args=["--password-store=basic","--disable-blink-features=AutomationControlled","--disable-dev-shm-usage"]`, `ignore_default_args=["--enable-automation","--no-sandbox"]`.
- Engine is `playwright` or opt-in `patchright` (`GFLOW_CLI_BROWSER_ENGINE`), both expose the same `chromium.launch_persistent_context`.
- Bootstrap: `await self._page.goto(routes.EDITOR_BOOTSTRAP_URL, wait_until="domcontentloaded", timeout=60_000)`.

**Profile location** (docs/ARCHITECTURE.md, docs/CONFIGURATION.md): `$GFLOW_CLI_HOME/profile_<name>/` = a full Chromium user-data-dir. Defaults: Windows `%LOCALAPPDATA%\gflow-cli\profile_default\`, macOS `~/Library/Application Support/gflow-cli/profile_default/`, Linux `~/.local/share/gflow-cli/profile_default/`. Cookies live in `Default/Cookies`.

**`channel_for_profile` — `src/gflow_cli/browser_manager.py`:** returns `"chrome"` only when the profile contains a marker file `.gflow_browser_strategy` written by the real-Chrome login (`docs/superpowers/memory/real-browser-auth-mandatory.md`: "A marker-less profile silently launches bundled Chromium → blocked"). `ensure_profile_engine_compatible` refuses to open a profile with an older Chromium major (#477: "Opening a Chrome profile with an older engine triggers Chromium's downgrade cleanup, which can leave the newer store — session cookies included — unreadable").

No `connect_over_cdp` anywhere in the launch path (ARCHITECTURE: "Playwright manages its own internal CDP port"). Headless: `GFLOW_CLI_HEADLESS` default `false`; docs say "reCAPTCHA Enterprise rejects headless Chromium with an immediate 403".

---

## 3. Login detection and `auth login`

### 3a. `gflow auth login` (default `--browser auto` → real Chrome if found)

**`src/gflow_cli/auth/real_chrome.py` — `RealChromeStrategy` ("Passive Capture"):**
```python
GEMINI_URL = "https://labs.google/fx/tools/flow?hl=en"
def _build_chrome_args(chrome_exe: str, profile_dir: Path, headless: bool) -> list[str]:
    """Construct Chrome command-line arguments for passive-capture login."""
```
- Spawns the **system Chrome binary with `asyncio.create_subprocess_exec`**, **no Playwright at all, no `--remote-debugging-port`** ("stealth mechanism"), args `--user-data-dir={profile_dir}` + `GEMINI_URL` as positional URL (+ `--headless=new` only if asked).
- User signs in by hand, then **closes Chrome** (CHANGELOG 0.54.0: "Closing Chrome window signals completion… Chrome holds exclusive lock on cookie store"). Timeout `GFLOW_CLI_AUTH_LOGIN_TIMEOUT` default 600 s → exit 12.
- After exit: writes marker `.gflow_browser_strategy`, runs `verify_flow_profile()`, writes verified email to `.gflow_account`, rolls the marker back on failure.

Why: `docs/superpowers/memory/real-browser-auth-mandatory.md` — "Google's `accounts.google.com` sign-in/OAuth flow rejects automated and Playwright-bundled-Chromium browsers (the 'G12 block' — `/v3/signin/rejected`, 'this browser may not be secure'). Only the user's real installed Google Chrome is accepted."

**`src/gflow_cli/auth/internal_chromium.py` — fallback Playwright login:**
```python
ctx = await pw.chromium.launch_persistent_context(
    user_data_dir=str(profile_dir),
    headless=headless,
    viewport={"width": 1920, "height": 1080},
    args=["--password-store=basic"],
)
await page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=60_000)
user_email = await _poll_session_until_authenticated(ctx, page, self._timeout_seconds, self.name)
```
Polls the session endpoint (below) every cycle, checks `SAPISID` cookie presence, and detects Google's rejection redirect `accounts.google.com/v3/signin/rejected` → `AuthBrowserRejectedError` (exit 14).

### 3b. "Logged in?" checks

**HTTP probe — `src/gflow_cli/auth/verification.py`:**
- Endpoint `https://labs.google/fx/api/auth/session` with `Referer: https://labs.google/fx/tools/flow`.
- Cookies that matter: `SAPISID` (Google SSO) and `__Secure-next-auth.session-token` (Flow's NextAuth session). The selector-registry spike found "only `__Secure-next-auth.session-token` (1088 chars, scoped to `labs.google`) is required" to load the editor.
- Authenticated iff HTTP 200 and JSON has `user.email` non-empty. Timeout 15 000 ms, 3 attempts, retry on 429/503/504, backoff 1 s, 2 s (cap 8 s).
- `gflow auth status` uses this path via `browser_cookie3` + `httpx` (no browser launch).
- `client.py` reads the same endpoint (`_SESSION_API_URL = "https://labs.google/fx/api/auth/session"`) to obtain `access_token`; missing token → `AisandboxAuthError(detail="no access_token in /fx/api/auth/session")`.

**DOM gate — `UiAutomationTransport._check_logged_in` (develop, verbatim):**
```python
@staticmethod
async def _check_logged_in(page: Page) -> bool:
    if flow_host_kind(page.url) is None:        # host must be labs.google or flow.google.com (parsed, exact)
        return False
    if _PROJECT_URL_FRAGMENT in page.url:       # /project/<uuid> => editor open => logged in
        return True
    try:
        signin_button = await page.locator(
            "button:has-text('Sign in'), a:has-text('Sign in')",
        ).count()
    except Exception:
        signin_button = 0
    return signin_button == 0
```
`_FLOW_HOSTS = {"labs.google": "labs", "flow.google.com": "migrated"}` (`_common.py`).

Session lifetime: docs/AUTHENTICATION.md — "Google sessions don't have a fixed lifetime"; the selector-registry design notes a CI token "hard-dies at day 30 without warning" (that is for the extracted cookie in CI, not the profile).

---

## 4. Text-to-image / image-with-reference: selectors

Order of operations inside `_generate_images_locked` (from v0.30.0 read + develop tests `test_ui_automation_image_mode.py`, which pin the order):
1. `_enter_editor` 2. `_dismiss_blocking_overlays` 3. (optional `_force_agent_mode`) 4. `get_ui_driver` cohort probe 5. `switch_to_image_mode` (once per editor mount, before any prompt) 6. `configure_image_settings` (model → aspect → count, then Escape) 7. attach refs: `ref_paths` (local files) → `refs` (UUIDs) → `reference_entities` (characters) 8. attach `page.on("response")` listener + request logger 9. `submit_time = time.monotonic()` 10. `send_prompt` (type + click arrow_forward) 11. `_await_captured(... timeout 180 s)` 12. parse → `GeneratedImage` 13. download.

### 4.0 Overlay / consent dismissal (runs before everything)

`ui_automation.py` (develop):
```python
CHANGELOG_IFRAME_SELECTORS = (
    "iframe[src*='/flow/changelogs/']",
    "iframe[src*='/changelogs/']",
)
TOP_BANNER_SELECTORS: tuple[str, ...] = (
    "[role='banner']",
    "a[href*='changelog']",
    "a[href*='changelogs']",
)
OVERLAY_CLOSE_BUTTON_SELECTORS: tuple[str, ...] = (
    "[role='dialog']:has(a[href*='changelog']) button",
    "button:has(i.google-symbols:text('clear'))",
    "button:has(i:text('close'))",
    # ... generic variants (v0.10.0 list: "[aria-label='Close']", "[aria-label='close']",
    # "[aria-label='Dismiss']", "[aria-label='dismiss']", "[aria-label='Cancel']",
    # "button:has(i.google-symbols:text('close'))", "[role='dialog'] button:has(i:text('close'))",
    # "[role='dialog'] button[aria-label*='close' i]", "button[data-dismiss]")
)
_ONBOARDING_STRUCTURAL_SELECTORS = (
    "button#L2AGLb",                      # Google consent SDK
    "button[aria-label='Accept all']",
    "button[aria-label='I agree']",
)
# ONBOARDING_SELECTORS additionally has ~50 text variants in 14 locales, e.g.
# "button:has-text('Accept all')", "button:has-text('Create with Flow')",
# "button:has-text('Get Started')", "button:has-text('Aceitar tudo')", ...
_BLOCK_PROBE_JS = """
() => ({
  pointerEvents: getComputedStyle(document.body).pointerEvents,
  dialogs: document.querySelectorAll("[role='dialog'],...").length,
})
"""
```
Dismissal sequence (`_dismiss_blocking_overlays`): detect (`_detect_overlay`) → try changelog-scoped close → probe whether app is clickable (`body { pointer-events: none }` means blocked) → generic close buttons → close button inside the iframe → `page.keyboard.press("Escape")` (only if actually blocked) → re-probe; if still blocked, `_require_unblocked` aborts with exit 23 + screenshot. A cross-cutting note (spec 2026-08-27): Flow's announcement modal sets `body { pointer-events: none }`, so a visible-but-covered button passes `wait_for(visible)` and then eats Playwright's 30 s click timeout — that is why every click in `_enter_editor` has an explicit `timeout=5000`.

### 4.1 Cohort detection (classic vs agentic) — `drivers/factory.py`, `mode_control.py`

```python
# mode_control.py
AGENT_TOGGLE_SELECTOR = "button[aria-pressed]:has(span.content)"
CROP_SELECTORS = (six crop buttons: crop_16_9, crop_9_16, crop_square, crop_portrait, crop_landscape, crop_original)
_SETTLE_MS = 1200; _COMPOSER_READY_TIMEOUT_MS = 8000; _RELOAD_TIMEOUT_MS = 15_000
# factory.py
AGENT_TUNE_INDICATOR_SELECTOR = "i.google-symbols:text-is('tune')"
AGENTIC_INDICATOR_SELECTORS = (
    "i.google-symbols:text-is('tune')",
    "i.google-symbols:text-is('apps_spark_2')",
    "i.google-symbols:text-is('article_spark')",
    "i.google-symbols:text-is('edit_square')",
)
```
Rule: classic if any `crop_*` trigger exists; agentic if no `crop_*` AND an agentic ligature exists; poll 8 s at 0.4 s, default classic. Probe **per page load** — "never cache drivers across navigations". There is no client-side signal (localStorage/cookies identical) — `docs/AGENT_UI_RECON.md`.

### 4.2 Switch to Image mode (classic)

`ui_automation_video.py` (develop) — the mode dropdown trigger is the **aspect-ratio crop icon button**:
```python
MODE_SWITCH_TRIGGER_SELECTORS = (
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_16_9'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_9_16'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_square'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_portrait'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_landscape'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_original'))",
)
VIDEO_TAB_IN_MENU_SELECTORS = (
    "[role='tab'][id$='-trigger-VIDEO']",
    "[role='tab'][aria-controls$='-content-VIDEO']",
    "[role='menu'] [role='tab']:has(i:text('play_circle'))",
    "[role='menu'] [role='tab']:has-text('Vídeo')",
    "[role='menu'] [role='tab']:has-text('Video')",
)
```
`ui_automation.py` (develop):
```python
IMAGE_TAB_IN_MENU_SELECTORS = (
    "[role='menu'] [role='tab'][aria-controls*='IMAGE']",
    "[role='tab'][aria-controls*='IMAGE']",
    "[role='menu'] [role='tab']:has-text('Imagem')",
    "[role='menu'] [role='tab']:has-text('Image')",
    "[role='menu'] [role='tab']:has(i:text('image'))",
)
GEN_SETTINGS_BUTTON_SELECTORS = MODE_SWITCH_TRIGGER_SELECTORS   # same button opens the settings panel

async def _switch_to_image_mode(page: Page, *, out_dir: Path | None = None) -> None:
    trigger = await VideoGenerationMixin._probe_selector_cascade(page, "mode_switch_trigger", MODE_SWITCH_TRIGGER_SELECTORS)
    await trigger.click()
    await page.wait_for_timeout(_jitter_ms(800))
    image_tab = await VideoGenerationMixin._probe_selector_cascade(page, "image_mode_tab", IMAGE_TAB_IN_MENU_SELECTORS)
    await image_tab.click()
    await page.wait_for_timeout(_jitter_ms(1200))
    await page.keyboard.press("Escape")
```
Why mandatory: "Flow's editor remembers last-used mode per account; without an explicit switch, submissions silently route to the wrong endpoint and the listener times out" (`docs/superpowers/memory/image-video-mode-switch-symmetry.md`; incident 2026-05-23 generated a video when an image was intended). Miss → `UiSelectorDriftError` with `diag_mode_switch_miss.json` (no screenshot) or `debug_no_image_tab.png`.

### 4.3 (a) Prompt textbox

`ui_automation.py` (develop):
```python
PROMPT_INPUT_SELECTORS = (
    'div[role="textbox"][data-slate-editor="true"]',
    'div[contenteditable="true"]',
    "textarea",
    '[aria-label*="prompt"]',
)
async def _locate_prompt_box(self, page, out_dir=None):
    for selector in PROMPT_INPUT_SELECTORS:
        try:
            loc = page.locator(selector).first
            await loc.wait_for(state="visible", timeout=10_000)
            return loc
        except Exception:
            continue
    # (falls through to drift error with screenshot)

async def _send_prompt(self, page, prompt_text, out_dir=None, format_prompt=False):
    input_box = await self._locate_prompt_box(page, out_dir)
    await input_box.click()
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Delete")
    await page.keyboard.insert_text(prompt_text)     # NOT fill() — it's a Slate editor
    await page.wait_for_timeout(_jitter_ms(500))
    # then self._click_submit(page)
```
The composer is a **Slate.js contenteditable** (`data-slate-editor="true"`). `keyboard.insert_text` is used everywhere (agentic driver: "Slate contenteditable (keyboard.insert_text, not fill())"). Note from `_common.py`: "A staged R2V character entity is NOT affected by the clear: 'Incluir no comando' stages it in a separate references drawer, not as a chip inside this prompt box." Agentic placeholder text observed: "What do you want to create?".

### 4.3 (b) Reference image upload (local file)

The image path reuses the video mixin's media dialog: `if request.ref_paths: await self._attach_references(page, list(request.ref_paths), out_dir=out_dir)` (v0.30.0 `_generate_images_locked`; develop cli_image.py confirms local files "attached through the editor's media dialog by the ui_automation transport").

`ui_automation_video.py` (constants verbatim from develop; method bodies verbatim from **v0.20.0** because develop is truncated there — develop still defines these names):
```python
UPLOAD_IMAGE_ROUTE = "uploadImage"
ADD_MEDIA_BUTTON = "button[aria-haspopup='dialog']:has(i.google-symbols:text-is('add_2'))"
UPLOAD_MEDIA_BUTTON = "[role='dialog'][data-state='open'] button:has(i.google-symbols:text-is('upload'))"
UPLOAD_MEDIA_BUTTON_TEXT = "[role='dialog'][data-state='open'] button:has-text('Upload media')"
ADD_TO_PROMPT_DIALOG = "[role='dialog'][data-state='open']"
DIALOG_ANY = "[role='dialog']"
FRAME_SLOTS_STRUCT = "div[type='button'][aria-haspopup='dialog']"          # I2V start/end slots (video only)
FRAME_SLOT_BY_LABEL = "div[aria-haspopup='dialog']:has-text('{label}')"

@staticmethod
async def _attach_references(page, images: list[Path], *, out_dir, timeout_s: float = 120.0) -> None:
    """R2V: attach up to MAX_REFERENCE_IMAGES reference images. References
    have no Start/End slots — each is added via the 'Add Media' button, which
    opens the same media dialog. Must run with the settings panel closed."""
    attached = 0
    for i, img in enumerate(images):
        add_media = page.locator(ADD_MEDIA_BUTTON).first
        try:
            await add_media.wait_for(state="visible", timeout=8000)
        except Exception as e:
            if i == 0:
                shot = await _capture_debug_screenshot(page, out_dir, "debug_no_add_media.png")
                raise RuntimeError(f"'Add Media' button not found for first reference. Screenshot: {shot}") from e
            log.warning("ui_automation_video.reference_cap_reached", attached=attached, requested=len(images),
                        note="Flow hid 'Add Media' — per-model reference cap reached")
            break
        await add_media.click()
        await page.wait_for_timeout(1000)
        await VideoGenerationMixin._upload_via_open_dialog(page, img, log_label=f"ref{i}", out_dir=out_dir, timeout_s=timeout_s)
        attached += 1
        log.info("ui_automation_video.reference_attached", index=i)

@staticmethod
async def _upload_via_open_dialog(page, image: Path, *, log_label, out_dir=None, timeout_s: float = 120.0) -> None:
    """With a media dialog ALREADY open, upload `image` and commit it into
    the active slot/carousel: 'Upload media' (file chooser) -> wait the
    uploadImage XHR 200 (bytes stored) -> 'Add to Prompt' -> wait the dialog
    to CLOSE (commit registered) before returning, so the caller never
    submits before the image binds."""
    uploaded: list[str] = []
    async def on_response(response):
        if UPLOAD_IMAGE_ROUTE in response.url:
            uploaded.append(response.url)
            log.info("ui_automation_video.image_uploaded", target=log_label, status=response.status)
    page.on("response", on_response)
    try:
        chooser = None
        for sel in (UPLOAD_MEDIA_BUTTON, UPLOAD_MEDIA_BUTTON_TEXT):
            try:
                async with page.expect_file_chooser(timeout=8000) as fc_info:
                    await page.locator(sel).first.click(timeout=4000)
                chooser = await fc_info.value
                break
            except Exception as e:
                last_err = e
        if chooser is None:
            shot = await _capture_debug_screenshot(page, out_dir, f"debug_upload_no_chooser_{log_label}.png")
            raise RuntimeError("Neither the icon nor the text 'Upload media' selector opened a file chooser ... "
                               "Workaround: set the CHROME BROWSER PROFILE's language to English ...") from last_err
        await chooser.set_files(str(image))
        deadline = time.monotonic() + timeout_s
        while not uploaded and time.monotonic() < deadline:
            await asyncio.sleep(0.5)
        if not uploaded:
            log.warning("ui_automation_video.upload_incomplete", target=log_label)
    finally:
        page.remove_listener("response", on_response)

    add_btn = (page.locator(ADD_TO_PROMPT_DIALOG).last.locator("button")
               .filter(has_not=page.locator("i.google-symbols")).last)   # the icon-less "Add to prompt" button
    if await add_btn.count():
        await add_btn.click()
    try:
        await page.locator("[role='dialog']").last.wait_for(state="hidden", timeout=15_000)
    except Exception:
        log.warning("ui_automation_video.dialog_close_timeout", target=log_label)
    await page.wait_for_timeout(1500)
```
Critical note in the file: "**set_input_files() on the generic hidden input only adds the image to the LIBRARY** — it does NOT associate it with the start/end frame slot … The frame slot MUST be filled through its own dialog: click the slot → 'Upload media' (opens a file chooser) → wait uploadImage → 'Add to Prompt' to commit it." I.e. use `expect_file_chooser` on the dialog's Upload button, not a hidden `<input type=file>`.

The upload XHR is `POST https://aisandbox-pa.googleapis.com/v1/flow/uploadImage` (routes.py `UPLOAD_IMAGE`); KNOWN_ISSUES: "Flow's `uploadImage` endpoint rejects some JPEGs with HTTP 400 (metadata-sensitive)" → exit 27 `MediaUploadRejectedError`; re-encode.

Reference cap: `MAX_REFERENCE_IMAGES` exists but I could not read its value **[NOT VERIFIED]**; the loop simply stops when Flow hides the Add-Media button.

Dedup: since v0.38.0 a local `--ref` whose filename was already uploaded in this project is attached from the library instead (`reference_deduped_by_filename` → `reference_attached; 0 image_uploaded events`, docs/LIVE_VERIFICATION_v0.38.0.md).

**Existing library asset (UUID ref) via the picker** — `_pick_option_and_include` (develop, verbatim):
```python
PICKER_SEARCH_INPUT = "#add-menu-input"
PICKER_INCLUDE_BUTTON: tuple[str, str] = (
    "button:has-text('Incluir no comando'), button:has-text('Добавить в запрос'), button:has-text('Add to prompt')",
    "[role='dialog'][data-state='open'] button:not(:has(i.google-symbols))",
)
PICKER_CONTEXT_INCLUDE: tuple[str, str] = (
    "[role='menu'][data-state='open'] [role='menuitem']:has(i.google-symbols:text-is('add'))",
    "[role='menu'] [role='menuitem']:has-text('Incluir no comando'), [role='menu'] [role='menuitem']:has-text('Добавить в запрос'), [role='menu'] [role='menuitem']:has-text('Add to prompt')",
)
PICKER_PERSONAGENS_TAB = "[role='tab']:has(i.google-symbols:text-is('accessibility_new')), button:has(i.google-symbols:text-is('accessibility_new'))"
REMOTE_PICKER_CLOSE_TIMEOUT_S = 120.0

async def _pick_option_and_include(page, name, *, surface, detail, out_dir, dialog_timeout_s):
    search_input = page.locator(PICKER_SEARCH_INPUT)
    await search_input.press_sequentially(name, delay=random.randint(10, 50))   # human-like typing
    await page.wait_for_timeout(600)
    tile = VideoGenerationMixin._remote_option_tile(page, name).first
    await tile.wait_for(state="visible", timeout=8000)
    await tile.click()
    await page.wait_for_timeout(300)
    # #529: clicking the result tile now attaches directly and closes the picker
    dialog = page.locator(DIALOG_ANY).last
    try:
        await dialog.wait_for(state="hidden", timeout=3000)
    except Exception:
        pass
    else:
        return
    include = await VideoGenerationMixin._resolve_include_action(page, PICKER_INCLUDE_BUTTON, ...)
    await include.click(timeout=3000)
    await page.wait_for_timeout(600)
    await page.locator(DIALOG_ANY).last.wait_for(state="hidden", timeout=dialog_timeout_s * 1000)  # else TransportTimeoutError

@staticmethod
def _remote_option_tile(page, name) -> Locator:
    # picker dialog exposes NO accessible tree (option's computed name is empty) — match text
    pattern = re.compile(rf"^{re.escape(name)}(\s?[^\Wa-z0-9_]\S*)?$")   # tolerates trailing "Imagem"/"Image" badge
    return page.locator("[role='option']", has_text=pattern)
```
Exact-tile verification uses `[role='option']:has(img[src*='<uuid>'])` (spike 2026-08-15). The picker's library view is **per-project**, so `_sync_picker_project` aligns a project dropdown first (#287). The searchable name is Flow's `workflows[].metadata.displayName` from the generation response, not the prompt. `_attach_image_uuid_refs` body in `ui_automation.py` **[NOT VERIFIED — truncated in every ref I tried]**; it is called right after local refs and before `send_prompt`.

Image-mode Add-Media button also observed as `button[aria-haspopup='dialog'][aria-controls^='radix-']:has(i.google-symbols:text('add_2'))` (`scripts/dev/capture_image_add_media_dom.py`, distinguishing the editor-level button from the gallery's). The whole UI is **Radix** (tabs `[role='tab']` with `aria-controls`, dialogs with `data-state='open'`, menus `[role='menu']`).

### 4.3 (c) Model picker

`ui_automation.py` (develop):
```python
IMAGE_MODEL_PICKER_TRIGGER = (
    "button[aria-haspopup='menu']:has(i.google-symbols:text-is('arrow_drop_down'))"
)
IMAGE_MODEL_OPTION_SELECTORS: dict[Model, tuple[str, ...]] = {
    Model.NARWHAL: ("[role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite'))",),
    Model.GEM_PIX_2: ("[role='menuitem']:has-text('Nano Banana Pro')",),
    Model.IMAGEN_3_5: ("[role='menuitem']:has-text('Imagen 4')",),
}
```
CLI aliases (docs/USAGE.md): `nano2` = Nano Banana 2 (`NARWHAL`, default), `nano-pro` = Nano Banana Pro (`GEM_PIX_2`), `image4` = Imagen 4 (`IMAGEN_3_5`). Internal ids `NARWHAL` / `GEM_PIX_2` / `IMAGEN_3_5` are what the wire body carries.

`_select_image_model` (v0.30.0 verbatim; develop hardened): must run with the settings panel open; click trigger (wait 4 000 ms visible) → `wait_for_timeout(500)` → first visible option (4 000 ms) → click → 500 ms. Since v0.61.0 a miss or an **ambiguous** match (>1 visible, checked via `count_visible`) raises `UiSelectorDriftError` before submit instead of silently generating on the picker's current model ("Flow removed `Imagen 4` from picker; selector became ambiguous with `Nano Banana 2 Lite`"). `offered_menu_labels(page)` reads what the menu actually shows for the error message:
```python
READ_MENU_ITEM_LABELS = r"""
() => Array.from(document.querySelectorAll("[role='menuitem']"))
    .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
"""
```
`close_menu` = press Escape twice ("close both model menu and generation-settings panel").

### 4.3 (d) Aspect ratio

```python
_ASPECT_TAB_CANDIDATES: dict[str, tuple[str, ...]] = {
    "16:9": ("16:9",), "9:16": ("9:16",),
    "1:1": ("1:1", "Square", "1×1", "1x1"),
    "4:3": ("4:3",), "3:4": ("3:4",),
}
_CLI_FROM_ASPECT = {Aspect.PORTRAIT: "9:16", Aspect.LANDSCAPE: "16:9", Aspect.SQUARE: "1:1",
                    Aspect.LANDSCAPE_FOUR_THREE: "4:3", Aspect.PORTRAIT_THREE_FOUR: "3:4"}

async def _apply_aspect_ratio(page, aspect_cli):
    for tab_text in candidates:
        # `:text-is(...)` is exact-match — `:has-text` substring would clash ("1:1" inside longer tabs)
        tab = page.locator(f'[role="tab"]:text-is("{tab_text}")').first
        await tab.wait_for(state="visible", timeout=2_000)
        await tab.click()
        ...
    # miss => log.warning("ui_automation.aspect_ratio_set_failed") (non-fatal)
```
Inside the settings panel there are **three Radix tablists** rendered at once (mode / aspect / count), all with `aria-selected` — hence the exact-text filters.

### 4.3 (e) Output count (x1/x2/x3/x4)

```python
_SUPPORTED_COUNTS = frozenset({1, 2, 3, 4})
_COUNT_TAB_TEXT_RE = re.compile(r"^(1x|x[1-4])$")    # two label cohorts: "1x" and "x1".."x4"

def _count_tabs_locator(page) -> Locator:
    return page.locator('[role="tab"]').filter(has_text=_COUNT_TAB_TEXT_RE)

async def _read_displayed_count(page) -> int | None:
    selected = page.locator('[role="tab"][aria-selected="true"]').filter(has_text=_COUNT_TAB_TEXT_RE)
    text = (await selected.first.text_content(timeout=500) or "").strip()
    m = re.search(r"\d", text); return int(m.group()) if m else None

async def _is_settings_panel_open(page) -> bool:
    return await _count_tabs_locator(page).first.is_visible()
```
`_set_count` (v0.30.0 verbatim algorithm): ensure panel open (don't toggle it closed) → read displayed → if equal, return → click `_count_tabs_locator(page).nth(count - 1)` (positional, locale-invariant) with 3 000 ms visibility wait → 300 ms → read back → up to 3 attempts with 500 ms pauses → on non-convergence raise (now `UiSelectorDriftError` carrying `desired=`/`displayed=` + screenshot, PR #405). Diagnostic dump `count_panel_dom_prompt_{idx}.json`. Earlier Portuguese labels ("1 imagem", "2 imagens") broke text matching, which is why it's positional.

The panel is closed afterwards with `page.keyboard.press("Escape")` + 400 ms (`_configure_generation_settings`).

### 4.3 (f) Generate / submit button

```python
SUBMIT_BUTTON_SELECTORS = (
    "button:has(i.google-symbols:text('arrow_forward'))",
    "button:has(i:text('arrow_forward'))",
    "button:has-text('arrow_forward')",
)
async def _click_submit(self, page):
    for sel in SUBMIT_BUTTON_SELECTORS:
        try:
            btn = page.locator(sel).first
            await btn.wait_for(state="visible", timeout=2_000)
            await btn.click()
            return
        except Exception:
            continue
    await page.keyboard.press("Enter")          # fallback
```
Registry note: this selector is deliberately NOT `expect_unique` — "this can legitimately match a top-level submit, an in-panel submit and a Send-to-Agent submit at once". On the migrated host the Angular composer flips `arrow_forward` from disabled ~100 ms after `insert_text`, so it polls up to 5 s (100 ms) for enablement (CHANGELOG 0.68.0) — worth copying on labs too.

### 4.3 (g) Detecting generation finished (classic) — network capture, no DOM polling

`ui_automation.py` (v0.30.0 verbatim; develop same shape):
```python
@staticmethod
def _attach_batch_response_listener(page, *, project_id=None):
    captured: list[dict[str, Any]] = []
    async def on_response(response):
        if "batchGenerateImages" not in response.url:
            return
        log.info("ui_automation.batch_response_seen", url=response.url, status=response.status, ...)
        if project_id and f"/projects/{project_id}/" not in response.url:
            return                                     # another project's traffic
        try:
            body = await response.json()
        except Exception as e:
            log.warning("ui_automation.batch_response_parse_failed", ...); return
        captured.append({"status": response.status, "url": response.url, "body": body, "ts": time.monotonic()})
    page.on("response", on_response)
    return captured, detach

@staticmethod
async def _await_captured(captured, timeout_s: float = 180.0, *, expected_count: int = 1,
                          submit_time: float = 0.0, poll_interval_s: float = 0.5,
                          straggler_window_s: float = 2.5):
    deadline = time.monotonic() + timeout_s
    def _fresh(): return [e for e in captured if e.get("ts", 0.0) >= submit_time]
    while time.monotonic() < deadline and len(_fresh()) < expected_count:
        await asyncio.sleep(poll_interval_s)
    fresh = _fresh()
    if not fresh:
        raise TimeoutError(f"No batchGenerateImages response within {timeout_s:.1f}s.")
    if len(fresh) < expected_count:
        log.warning("ui_automation.fewer_responses_than_expected", ...)
    else:
        await asyncio.sleep(straggler_window_s); fresh = _fresh()
    return fresh
```
Sequence: listener attached synchronously **before** the click; `submit_time = time.monotonic()`; `send_prompt`; `_await_captured(captured, expected_count=request.count, submit_time=submit_time)`. Responses stamped before `submit_time` are ignored (stale). Timeout → `TransportTimeoutError` exit 9 ("gflow image t2i hangs ≥ 3 min then fails with TimeoutError" — docs/DEBUGGING.md; if `prompt_submitted` is followed by no `batch_response_seen`, the request never fired, usually wrong mode).

Response parsing (`_collect_images_from_body`): body `media[]` items → `GeneratedImage.from_response_dict()` reading `mediaId`/`fifeUrl`/seed/aspect and sibling `workflows[].metadata.displayName`; attribution fields `modelNameType`/`seed`/`aspectRatio` also readable from `flow.projectInitialData`. Status handling in `_images_from_responses`: 401 → `AuthExpiredError` (exit 3); 403 → `WafRejectionError(detail="HTTP 403 — reCAPTCHA score too low or WAF fingerprint mismatch")` (exit 10); 429 → `RateLimitError` with `Retry-After` (exit 4); 400 → `ContentPolicyError` when `details[].reason` ∈ `{PUBLIC_ERROR_UNSAFE_GENERATION, PUBLIC_ERROR_UNSAFE_CONTENT, PUBLIC_ERROR_UNSAFE_FACE, PUBLIC_ERROR_UNSAFE_IDENTITY}` (exit 5); HTTP 200 with empty `media[]` is also treated as content-policy. Sample bodies are checked in at `samples/captured/06_batchGenerateImages.json` and `07_batchGenerateImages_seeded.json` (not fetched here).

**Agentic cohort** — `drivers/agentic.py` (develop, verbatim): page-level network capture is dead (requests go from a Web Worker to `POST https://aisandbox-pa.googleapis.com/v1/flowCreationAgent:streamChat?alt=sse`), so it scrapes the DOM:
```python
_POLL_INTERVAL_S = 0.5
_AWAIT_TIMEOUT_S = 180.0
_MEDIA_UUID_RE = re.compile(r"[?&]name=([0-9a-fA-F-]+)")   # applied to every <img src>
# baseline = union of two scrapes one poll apart; new = current - baseline;
# success when len(new) == expected on two consecutive scrapes; > expected => MediaAttributionError
_POLICY_REGION_SELECTOR = '[role="alert"], [aria-live="assertive"], [role="dialog"]'
_POLICY_TEXT_SIGNALS = ("content policy", "can't create", "violat", "not able to generate")
def _compose_directive(count, aspect, prompt_text):
    subject = "a picture" if count == 1 else f"{count} pictures"
    aspect_clause = f" in a {aspect} aspect ratio" if aspect else ""
    return f"Make me {subject} of {prompt_text}{aspect_clause}."
```
Result `<img src>` in the agentic UI is `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<uuid>` (one asset → ~3 `<img>` nodes, dedupe by uuid). Count is additionally enforced through the agent `tune` settings panel (`button:has(i.google-symbols:text-is('tune'))`, back via `arrow_back`).

### 4.3 (h) Downloading results

- Classic: `FlowApiClient.download_image(image, out_path)` → `page.request.get(image.fife_url, max_redirects=2, timeout=120_000)` after `_validate_fife_url` (https + host allowlist). Allowlist in `ui_automation.py`:
  ```python
  _ALLOWED_DOWNLOAD_HOST_SUFFIXES = ("googleusercontent.com", "googleapis.com", "google.com", "labs.google", "flow-content.google")
  ```
  `fife_url` comes straight from the captured `batchGenerateImages` JSON (signed CDN URL; migrated-host media lives on `flow-content.google` and needs no cookies).
- Agentic / by media id: `routes.media_download_url(uuid)` = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<uuid>` fetched with `page.request.get(url, max_redirects=5, timeout=180_000)` (`_download_video` pattern, same for images). Note: this labs redirect returns 404 for migrated-host media ids.
- Naming (`image_batch._download_item_images`): `output_dir / f"{stem}_{img_idx}.png"`, stem = `output_filename or f"prompt_{index}"`.
- No Flow "download button" is ever clicked, no `expect_download`.

### 4.3 (i) Errors / toasts

Classic image path has **no toast/snackbar selectors** — all error classification is from the captured HTTP status/body (above). Only the agentic driver scans `[role="alert"], [aria-live="assertive"], [role="dialog"]` text. The migrated composer checks `[role='dialog']` + `mat-icon:text-is('close')` for modal dismissal. Other typed UI errors: `FlowAppError` (exit 31, "Flow client-side exception"), `MediaUploadRejectedError` (27), `ReferenceNotFoundError` (32, lists what the picker offered).

---

## 5. Using a generated image as the reference for the next generation

There is **no "click the result tile → use as reference" gesture**. All chaining is by identity:
- Each generated image's `mediaId` (UUID) and Flow `displayName` are recorded in a local SQLite catalog. Next run: `gflow image i2i "..." --ref <uuid>` → `_classify_ref` (`cli_image.py`) recognises the 8-4-4-4-12 hex → `ImageRef(name=uuid)` → transport opens the Add-Media picker, aligns the project dropdown, types the catalog display name into `#add-menu-input`, and clicks the `[role='option']` tile whose `img[src*='<uuid>']` matches (§4.3b). "no duplicate upload" (docs/USAGE.md). Falls back to re-uploading the recorded local copy if the name search misses and the bytes still match the recorded sha256 (`_attach_frame_by_media_id`, v0.58.0).
- `gflow image batch`: items may carry `ref: "batch:N"` / `reference_entity: "batch:N"`; `resolve_batch_dependencies()` topologically sorts, and before submitting item N+1 the executor substitutes item N's generated media id (plan `docs/superpowers/plans/2026-08-05-issue-317-intra-batch-references/PLAN.md`; failed upstream → `dependency_failed`). Whether the actual reference injection for `batch:N` is implemented in `image_batch.py` I could not confirm — the fetch found only the DAG resolver **[NOT VERIFIED]**.
- Durable identity: `gflow character` creates a Character entity (`flow.createEntity` tRPC) with ≥1 reference image; `@Name` in the prompt or `--reference-entity <entityId>` resolves to `requests[].referenceEntities[].entityId` in the `batchGenerateImages` body (docs/REFERENCE_STRATEGIES.md). Local `--ref` files become `referenceImages` instead.
- Video: `gflow video chain` seeds link N+1 with the extracted last frame of clip N (ffmpeg locally, then normal I2V upload).

---

## 6. Selector drift (exit 23) vs timeout, and timing/jitter

### Drift detection
- Every UI probe goes through a **selector cascade**; a cascade miss is a typed `UiSelectorDriftError` (exit 23), never a bare `RuntimeError` (bare exceptions get their message SHA-256-hashed by `observability.py` and the user sees only "Unexpected error" — `docs/superpowers/memory/ui-selector-drift-error-exit-23.md`).

`ui_automation_video.py` (develop, verbatim):
```python
@staticmethod
async def _probe_selector_cascade(page, label, candidates, *, timeout_ms: int = 4000, overlay_retry: bool = True):
    """Try each selector in order; return first visible match or None."""
    for selector in candidates:
        try:
            loc = page.locator(selector).first
            await loc.wait_for(state="visible", timeout=timeout_ms)
            return loc
        except Exception:
            log.debug("ui_automation_video.selector_miss", probe=label, selector=selector)
    log.warning("ui_automation_video.selector_probe_failed", probe=label)
    if not overlay_retry:
        return None
    if not await UiAutomationTransport._overlay_blocks_page(page):
        return None
    if not await UiAutomationTransport._changelog_overlay_present(page):
        return None
    # control covered, not missing — dismiss & re-probe once
    return await VideoGenerationMixin._probe_selector_cascade(page, label, candidates, timeout_ms=timeout_ms, overlay_retry=False)

def selector_drift_detail(probe: str, what: str, shot: Path | None) -> str:
    detail = f"probe={probe}: {what}"
    return f"{detail} Screenshot: {shot}" if shot is not None else detail
```
`errors.py`:
```python
class UiSelectorDriftError(GFlowError):
    """Raised when a UI-automation selector cascade finds no matching element. ..."""
    title = "Flow UI selector drift"
    # exit 23
class TransportTimeoutError(GFlowError):
    """Raised when a transport strategy hangs > 30s on a single API call."""
    # exit 9
```
- **Drift vs timeout rule**: drift = a *control* could not be located (cascade exhausted after ~4 s per candidate, or a settings setter didn't converge); timeout = the control was found and clicked but the expected *network response / DOM change* never arrived (180 s image listener, 600 s video poll). Exit 23 is raised **pre-submit** wherever possible so no credits are spent (model picker, count, mode tabs, unbound frame chip, blocked overlay). The registry probe adds a third outcome: **exit 2 inconclusive** when the surface never hydrated (dead project id, expired token) — "A DOM probe MUST … tell 'the surface did not load' from 'a selector drifted'" (`docs/superpowers/specs/2026-08-21-selector-registry-design.md`).
- Known false-drift causes they now special-case: the flow.google.com migration (zero `<i>` ligatures → every selector misses → exit 36 not 23), the agentic cohort (exit 25/28), the expanded chat sidebar (#493), viewport < 1920×1080, and the announcement modal (`pointer-events:none`).
- Diagnostic signature for "clicked the wrong element": ~34–38 s gap between last log line and TimeoutError (8 s visibility wait + 30 s default downstream wait) — `docs/superpowers/memory/playwright-click-no-downstream-event-signature.md`. Example: Portuguese "Enviar mídia" vs "Upload media".
- **Selector authoring rule** (`docs/superpowers/memory/flow-locale-leak-icon-ligatures.md`): Flow renders labels in the **Chrome profile language** (not the account language, not `--lang`). Prefer Material Symbols ligatures: `button:has(i.google-symbols:text('<ligature>'))` with `add_2`, `upload`, `crop_16_9`, `arrow_forward`, `arrow_drop_down`, `play_circle`, `image`, `tune`, `close`, `clear`, `videocam`, `accessibility_new`, `voice_selection`. For icon-less buttons use structure, e.g. `.filter(has_not=page.locator("i.google-symbols"))`.
- Registry (`flow_selectors/registry.py`): keys `editor.composer.input` (= `PROMPT_INPUT_SELECTORS`), `editor.composer.submit` (= `SUBMIT_BUTTON_SELECTORS`), `editor.agent_toggle` (`button[aria-pressed]:has(span.content)`, expect_unique), `editor.crop_control` (= `CROP_SELECTORS`, classic mode only). Surface `editor` url `https://labs.google/fx/{locale}/tools/flow/project/{project_id}` at 1920×1080. Grades: HIT / FALLBACK HELD / AMBIGUOUS / MISS / EXPECTED_ABSENT. Nightly CI probe `scripts/probe/run_probe.py` (exit 0/1/2).

### Timing / randomisation (exact numbers)
- Per-interaction jitter (`ui_automation.py`, develop):
  ```python
  def _jitter_ms(base_ms: int, variance: float = 0.25) -> int:
      if base_ms <= 0: return 0
      delta = int(round(base_ms * max(0.0, min(1.0, variance))))
      return max(1, secrets.SystemRandom().randint(base_ms - delta, base_ms + delta))
  ```
  i.e. **±25 %** around base; bases seen: 500 ms after typing, 800 ms after opening the mode menu, 1200 ms after clicking the Image tab, 1000 ms misc. Uses `secrets.SystemRandom` (SonarCloud S2245, v0.54.0). Fixed waits still present: 3000 ms after gallery load, 600 ms after opening settings, 400 ms after Escape, 300/500 ms in count setter, 1000 ms after Add-Media click, 1500 ms after dialog close.
- Between prompts in multi-prompt runs (`image_batch.py`): `JITTER_MIN_SECONDS = 0.5`, `JITTER_MAX_SECONDS = 1.5`, `delay = random.uniform(*jitter_range); await asyncio.sleep(delay)`; override with `--jitter 'MIN-MAX'` / `GFLOW_CLI_JITTER_RANGE`. "Deliberately small — enough to break a perfectly uniform burst signature".
- Picker typing: `press_sequentially(name, delay=random.randint(10, 50))` ms per char.
- Probe/poll constants: cascade `timeout_ms=4000`; prompt box 10 000 ms; submit 2 000 ms; new-project 5 000 ms wait + 5 000 ms click + 15 000 ms url; overlay close 15 000 ms; image response 180 s @ 0.5 s + 2.5 s straggler; upload 120 s @ 0.5 s; picker close 120 s; cohort detect 8 s @ 0.4 s; video status 600 s @ 2 s.

---

## 7. labs.google → flow.google.com migration (issue #639)

From README, KNOWN_ISSUES.md, errors.py, `docs/superpowers/spikes/2026-09-04-migrated-host-handoff-mechanism.md`, `2026-09-05-migrated-host-wire-protocol.md`, CHANGELOG 0.66.0–0.68.0:

- "Google is moving accounts from `labs.google` onto `flow.google.com` — same product, different widget toolkit and wire protocol (`batchexecute` instead of `aisandbox-pa`)."
- **Mechanism**: not DNS, not a 302. `labs.google/fx/tools/flow` returns 200 with a valid session; a **server-assigned per-account boolean in the runtime config (`useConfig()`)** makes the labs app run
  ```js
  if (!FLAG || suppress) return;
  let url = 'https://flow.google.com' + path + location.search;
  window.location.replace(url);
  ```
  (query kept, `/fx/**/tools/flow/` stripped). One-way, measured 5/5 and 7/7 with no flap; retry/re-login does not help. Detect via `framenavigated`/`page.url` host check (`flow_host_kind`).
- **DOM**: "The migrated frontend contains **zero `<i>` elements** where the old host had 55" — every ligature selector misses at once; that used to surface as exit 23 and now is exit 36 `FlowHostMigratedError`. The new UI is Angular Material: `.settings-trigger-button`, `.cdk-overlay-pane`, `[role='radiogroup']`/`[role='radio']` (aria-checked), `mat-icon` ligatures (`videocam`, `crop_free`, `crop_16_9`, `crop_9_16`, `arrow_drop_down`, `arrow_forward`, `add`, `upload`, `close`), composer `[contenteditable='true']`, model menu `[role='menuitem']`, custom elements `flow-prompt-box` (`button.empty-chip`, `button.chip-container:has(img)`), `flow-add-menu-popover-content` picker with `input[type='text']` search and `button.asset-item[role='option']`. Toolbar add button: `xpath=//button[.//mat-icon[normalize-space()='add']][not(ancestor::flow-prompt-box)]`.
- **Wire**: `POST https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute`, envelope `)]}'` + `wrb.fr` frames; rpcids `YhhmEf` (t2v submit) / `eb1hJf` (i2v submit), `jwpduf` (status poll every 5 s; status 6 submitted, 2 running, 3 done), `as29s` (result with signed URLs), `maseQ` (frame upload). Media served signed from `flow-content.google`. Status 3 can arrive before the URL record → 20 s grace (`RESULT_URL_GRACE_S`). Locale now only in `<html lang>` (no URL segment). Project URL `https://flow.google.com/project/<id>`; the project grid at `flow.google.com/` loads **no `recaptcha/enterprise.js`**.
- **Status today (v0.68.0 + Unreleased)**: ported = `video t2v --project` and `video i2v --initial-frame <local>`; **not ported = image t2i/i2i, end frames, UUID/@Name refs, R2V, characters, scenes, extend, tools, project creation** → exit 36. `GFLOW_CLI_FLOW_HOST=auto|flow.google.com|labs.google`. Old URL `labs.google/fx/tools/flow/project/<id>` redirects to `flow.google.com/project/<id>`.
- Both maintainer accounts are migrated, so labs-only behaviour is now "cohort-external — verify via a contributor or record it NOT verified" (`docs/superpowers/memory/flow-recon-must-run-on-denon82-ffroliva-migrated.md`). Expect your own account to flip at some point; write the driver with a host check first.

---

## 8. reCAPTCHA / rate limit / "unusual traffic"

- **Philosophy** (docs/ACCOUNT_SAFETY.md): "avoids looking like a bot by not behaving like one" — headed real Chrome, `--disable-blink-features=AutomationControlled`, `navigator.webdriver` undefined, ±25 % interaction jitter, 0.5–1.5 s pacing, isolated profile per account, **refuse rather than retry** (no retries on 403 so "profile heat" doesn't accumulate). Explicitly no proxies, no fingerprint spoofing, no headless workarounds, no stealth claims. Optional `patchright` engine "for stronger reCAPTCHA-Enterprise evasion on headed paths".
- **reCAPTCHA Enterprise** is invoked by Flow's own page JS when you click Generate; in the UI path the browser mints it itself. gflow additionally mints tokens for REST paths via `api/recaptcha.py`:
  ```js
  // discover site key
  () => { const scripts = document.querySelectorAll('script[src*="recaptcha/enterprise.js"]');
          for (const s of scripts) { const m = (s.getAttribute('src')||'').match(/[?&]render=([^&]+)/); if (m) return m[1]; } return null; }
  // mint
  async ([siteKey, action]) => new Promise((resolve, reject) => {
      if (typeof grecaptcha === 'undefined' || !grecaptcha.enterprise) return reject(new Error('grecaptcha.enterprise not loaded'));
      grecaptcha.enterprise.ready(() => grecaptcha.enterprise.execute(siteKey, { action }).then(resolve).catch(reject)); })
  ```
  Actions: `"IMAGE_GENERATION"`, `"VIDEO_GENERATION"`; tokens are single-use, ~2 min TTL, passed in the request body (`recaptcha_token` field of `GenerateImageRequest`), not a header. Empty token → error text blames "headless detection by Google". `client._mint_recaptcha_token` bails with exit 36 on `flow.google.com` (tests/api/test_client_migrated_mint.py).
- **Block patterns observed** (ACCOUNT_SAFETY / KNOWN_ISSUES): `batchGenerateImages` **HTTP 403** = "reCAPTCHA score too low or WAF fingerprint mismatch" → exit 10 `WafRejectionError`; body reason code `PUBLIC_ERROR_UNUSUAL_ACTIVITY` is the "unusual activity" flavour. "A burst of ~14 image submissions within 10 minutes resulted in 403, while 3-prompt runs spaced 30–60 minutes apart passed." WAF heat is **per Chrome profile**, decays over hours–days. Recovery: stop, cool down 30–60 min, use the account manually in real Chrome, or switch profile. **HTTP 429** → exit 4 `RateLimitError` with `Retry-After` ("Daily or per-minute model quota reached"). Baseline spike (`docs/superpowers/spikes/2026-07-09-camoufox-waf-403.md`): 20 Imagen generations in ~7.4 min with the stealth args above → 0 WAF 403s.
- WAF also correlates cookies with **browser-shaped headers**; for REST lanes they replay 11 captured headers (`_fingerprint.py`: user-agent, accept, accept-language, sec-ch-ua, sec-ch-ua-platform, sec-ch-ua-mobile, sec-fetch-dest/mode/site, origin, referer). Irrelevant if you only click the UI.
- Login blocks: Playwright's bundled Chromium is rejected at `accounts.google.com/v3/signin/rejected` ("this browser may not be secure") → always log in with real Chrome without automation flags.

---

## 9. Exit code table (docs/USAGE.md, verbatim subset)

0 ok · 1 unhandled · 2 usage · 3 AuthExpired · 4 RateLimit · 5 ContentPolicy · 6 Network · 7 WireFormat · 8 AuthMissing · 9 TransportTimeout · 10 WafRejection · 11 Configuration · 12 AuthLoginTimeout · 14 AuthBrowserRejected · 15 BrowserSessionClosed · 18 VideoModelSelection · 23 UiSelectorDrift · 24 BrowserEngineUnavailable · 25 FlowAgentUi · 26 MediaAttribution · 27 MediaUploadRejected · 28 UiModeUnavailable · 31 FlowAppError · 32 ReferenceNotFound · 36 FlowHostMigrated · 130 SIGINT.

---

## 10. Minimal Node/Playwright recipe distilled from the above (labs.google classic cohort)

1. `chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: false, viewport: {width:1920,height:1080}, locale: 'en-US', args: ['--disable-blink-features=AutomationControlled','--password-store=basic','--disable-dev-shm-usage'] })`; `context.addInitScript("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")`. Log in once by launching real `chrome.exe --user-data-dir=<profileDir> https://labs.google/fx/tools/flow?hl=en` **without** Playwright, then close Chrome.
2. Logged-in check: `context.request.get('https://labs.google/fx/api/auth/session')` → 200 with `user.email`; DOM fallback: no `button:has-text('Sign in')` on a labs.google page. If `page.url()` host becomes `flow.google.com`, stop — image gen isn't drivable there with these selectors.
3. `goto('https://labs.google/fx/tools/flow?hl=en')` → `waitForURL(/\/fx\/[a-z-]+\/tools\/flow/, {timeout:4000}).catch(()=>{})` → dismiss consent (`button#L2AGLb`, `button[aria-label='Accept all']`) and the changelog modal (`iframe[src*='/changelogs/']`, close via `[role='dialog']:has(a[href*='changelog']) button` / `button:has(i.google-symbols:text('clear'))` / Escape; verify `getComputedStyle(document.body).pointerEvents !== 'none'`).
4. New project: click `button:has(i.google-symbols:text('add_2'))` on the gallery, `waitForURL(u => u.includes('/project/'))`. Or `goto('https://labs.google/fx/<locale>/tools/flow/project/<id>')`.
5. Confirm classic cohort: some `button[aria-haspopup='menu']:has(i.google-symbols:text('crop_16_9'))` (or other crop_*) exists; if instead `i.google-symbols:text-is('tune')` etc. exists you're in the agentic chat UI.
6. Image mode: click that crop_* trigger → click `[role='menu'] [role='tab'][aria-controls*='IMAGE']` → Escape.
7. Settings: click the crop_* trigger again → model: `button[aria-haspopup='menu']:has(i.google-symbols:text-is('arrow_drop_down'))` then `[role='menuitem']:has-text('Nano Banana 2'):not(:has-text('Lite'))` / `'Nano Banana Pro'` / `'Imagen 4'` (bail if 0 or >1 visible) → aspect `[role="tab"]:text-is("9:16")` → count `page.locator('[role="tab"]').filter({hasText:/^(1x|x[1-4])$/}).nth(n-1)`, read back via `[role="tab"][aria-selected="true"]` → Escape.
8. Reference image: click `button[aria-haspopup='dialog']:has(i.google-symbols:text-is('add_2'))` → `const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator("[role='dialog'][data-state='open'] button:has(i.google-symbols:text-is('upload'))").first().click()])` → `chooser.setFiles(path)` → wait for a response whose URL contains `uploadImage` (≤120 s) → click the last icon-less `button` inside `[role='dialog'][data-state='open']` → wait `[role='dialog']` hidden (15 s). Existing asset: type its display name into `#add-menu-input`, click `[role='option']:has(img[src*='<uuid>'])`.
9. Prompt: `div[role="textbox"][data-slate-editor="true"]` → click → Ctrl+A, Delete → `keyboard.insertText(prompt)` → attach `page.on('response')` filter `url.includes('batchGenerateImages')` BEFORE clicking → click `button:has(i.google-symbols:text('arrow_forward'))` (Enter fallback) → wait ≤180 s for `count` fresh responses (+2.5 s straggler).
10. Parse `body.media[]` → `fifeUrl`, `mediaId`, `workflows[].metadata.displayName`; classify 401/403/429/400 as above → `page.request.get(fifeUrl)` → write file. Pause 0.5–1.5 s (random) between prompts; keep bursts well under ~14 submissions / 10 min.
