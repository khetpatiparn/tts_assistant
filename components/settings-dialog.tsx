"use client";

import { useEffect, useState } from "react";
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  Film,
  Info,
  Layers,
  Loader2,
  Mic,
  RotateCcw,
  Save,
  Scissors,
  Settings,
  Sliders,
  Sparkles,
  Volume2,
  X,
  Zap,
} from "lucide-react";

import { getSystemSettingsAction, saveSystemSettingsAction } from "@/app/actions";
import { playCompletionSound } from "@/lib/completion-sound";
import { type SystemSettings, DEFAULT_SETTINGS } from "@/lib/tts-config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TabKey = "automation" | "voice" | "quota" | "system";

const AVAILABLE_VOICES = [
  { id: "Tavi", name: "Tavi (แนะนำ)", desc: "หญิง · โทนกลาง-สูง · กระชับ ฉับไว ขายของ TikTok" },
  { id: "Aoede", name: "Aoede", desc: "หญิง · นุ่มนวล ชวนฟัง" },
  { id: "Zephyr", name: "Zephyr", desc: "หญิง · คล่องแคล่ว ทันสมัย" },
  { id: "Kore", name: "Kore", desc: "หญิง · สบายๆ ผ่อนคลาย" },
  { id: "Puck", name: "Puck", desc: "ชาย · สดใส มีชีวิตชีวา" },
  { id: "Charon", name: "Charon", desc: "ชาย · สุภาพ ทุ้มนุ่มลึก" },
  { id: "Fenrir", name: "Fenrir", desc: "ชาย · หนักแน่น จริงจัง" },
];

const DURATION_PRESETS = [
  { value: 9.6, label: "9.6 วิ (แนะนำ)" },
  { value: 10.0, label: "10.0 วิ (เพดานคลิป)" },
  { value: 8.5, label: "8.5 วิ (กระชับพิเศษ)" },
];

const TABS: { key: TabKey; label: string; subLabel: string; icon: typeof Zap }[] = [
  {
    key: "automation",
    label: "ระบบอัตโนมัติ",
    subLabel: "Auto Voiceover & Merge",
    icon: Zap,
  },
  {
    key: "voice",
    label: "เสียงพากย์ & ความยาว",
    subLabel: "Gemini TTS & Duration Tuning",
    icon: Mic,
  },
  {
    key: "quota",
    label: "โควตางานรายวัน",
    subLabel: "Desktop TTS Target",
    icon: Calendar,
  },
  {
    key: "system",
    label: "ข้อมูลระบบ & เครื่องมือ",
    subLabel: "Engine, FFmpeg, Pipeline",
    icon: Info,
  },
];

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("automation");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);

  function handleOpen() {
    setOpen(true);
    setSavedSuccess(false);
    setErrorMessage(null);
    setLoading(true);

    getSystemSettingsAction()
      .then((data) => {
        setSettings(data);
      })
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : "โหลดการตั้งค่าไม่สำเร็จ");
      })
      .finally(() => {
        setLoading(false);
      });
  }

  // ปิดด้วยปุ่ม Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setErrorMessage(null);
    setSavedSuccess(false);

    try {
      const res = await saveSystemSettingsAction({
        autoGenerateTts: settings.autoGenerateTts,
        autoMergeVideo: settings.autoMergeVideo,
        targetDurationSec: Number(settings.targetDurationSec),
        defaultVoice: settings.defaultVoice,
        defaultStyle: settings.defaultStyle,
        postsPerDay: Number(settings.postsPerDay),
      });

      if (!res.ok) {
        setErrorMessage(res.message ?? "บันทึกการตั้งค่าไม่สำเร็จ");
        playCompletionSound("error");
        return;
      }

      setSettings(res.settings);
      setSavedSuccess(true);
      playCompletionSound("success");
      setTimeout(() => {
        setSavedSuccess(false);
      }, 3000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      playCompletionSound("error");
    } finally {
      setSaving(false);
    }
  }

  function handleResetDefault() {
    setSettings({ ...DEFAULT_SETTINGS });
    setSavedSuccess(false);
    setErrorMessage(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="ตั้งค่าระบบและการทำงานอัตโนมัติ"
        title="ตั้งค่าระบบและการทำงานอัตโนมัติ"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-header-muted/50 text-header-foreground transition-colors hover:bg-header-foreground/10 focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none lg:size-9"
      >
        <Settings className="size-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5 backdrop-blur-xs duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="flex h-[88vh] max-h-[720px] min-h-[520px] w-full max-w-4xl lg:max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-2xl duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header ด้านบน */}
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Settings className="size-5" />
                </div>
                <div>
                  <h2 id="settings-dialog-title" className="text-sm font-bold sm:text-base leading-none">
                    ตั้งค่าระบบและการทำงานอัตโนมัติ
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    System Settings &amp; Automation Control Panel
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="ปิดหน้าต่างตั้งค่า"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-border-interactive/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* ส่วนตัวเครื่อง: แบ่ง 2 ฝั่ง (ซ้าย: รายการเมนูหลัก, ขวา: รายละเอียดเนื้อหา) */}
            <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
              {/* ฝั่งซ้าย: เมนูหลัก (Sidebar Tabs) */}
              <aside className="w-full shrink-0 border-b border-border bg-surface-2 p-2.5 sm:p-3 md:w-64 md:border-b-0 md:border-r lg:w-72 flex flex-row overflow-x-auto md:flex-col md:overflow-visible gap-1.5">
                <div className="hidden px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider md:block">
                  หมวดหมู่การตั้งค่า
                </div>

                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={cn(
                        "group flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors border",
                        isActive
                          ? "border-primary/40 bg-primary/10 text-foreground shadow-xs font-medium"
                          : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground"
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface text-muted-foreground group-hover:text-foreground"
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs sm:text-sm leading-tight truncate">
                          {tab.label}
                        </span>
                        <span className="hidden text-xs text-muted-foreground leading-tight md:block truncate">
                          {tab.subLabel}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {/* กล่องสรุปสถานะสั้นๆ ด้านล่างของ Sidebar */}
                <div className="hidden mt-auto rounded-lg border border-border bg-surface p-3 md:block">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    สถานะปัจจุบัน
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Auto Voiceover:</span>
                      <span className={cn("font-medium", settings.autoGenerateTts ? "text-primary" : "text-muted-foreground")}>
                        {settings.autoGenerateTts ? "เปิดใช้งาน" : "ปิด"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Auto Merge:</span>
                      <span className={cn("font-medium", settings.autoMergeVideo ? "text-primary" : "text-muted-foreground")}>
                        {settings.autoMergeVideo ? "เปิดใช้งาน" : "ปิด"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>เพดานเสียง:</span>
                      <span className="font-mono font-medium text-foreground">
                        {Number(settings.targetDurationSec).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                </div>
              </aside>

              {/* ฝั่งขวา: พื้นที่แสดงเนื้อหา (Content Panel) */}
              <main className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6 bg-surface">
                {loading ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <span className="text-xs">กำลังโหลดการตั้งค่าระบบ...</span>
                  </div>
                ) : (
                  <>
                    {/* หมวด 1: ระบบอัตโนมัติ (Automation Pipeline) */}
                    {activeTab === "automation" && (
                      <div className="flex flex-col gap-5">
                        <div>
                          <h3 className="text-sm sm:text-base font-bold text-foreground">
                            ระบบทำงานอัตโนมัติ (Automation Pipeline)
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                            เปิด-ปิดพฤติกรรมการผลิตสื่อโดยอัตโนมัติ เพื่อประหยัดเวลาและลดขั้นตอนการคลิก
                          </p>
                        </div>

                        {/* กล่อง Toggle: Auto Voiceover */}
                        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3.5">
                              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Mic className="size-5" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label
                                  htmlFor="toggle-auto-tts"
                                  className="cursor-pointer text-sm font-semibold text-foreground"
                                >
                                  สร้างเสียงพากย์อัตโนมัติ (Auto Voiceover)
                                </label>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  เมื่อกด &quot;สร้างด้วย AI&quot; หรือขั้นตอนสร้าง 10-part prompt เสร็จสิ้น ระบบจะส่งบทพากย์เข้าโมเดล
                                  Gemini 3.8 Flash TTS และตัดต่อความยาวให้อัตโนมัติทันที
                                </p>
                              </div>
                            </div>

                            <button
                              id="toggle-auto-tts"
                              type="button"
                              role="switch"
                              aria-checked={settings.autoGenerateTts}
                              onClick={() =>
                                setSettings((s) => ({ ...s, autoGenerateTts: !s.autoGenerateTts }))
                              }
                              className={cn(
                                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                                settings.autoGenerateTts ? "bg-primary" : "bg-muted"
                              )}
                            >
                              <span
                                className={cn(
                                  "pointer-events-none inline-block size-5 transform rounded-full bg-surface shadow-sm ring-0 transition duration-200 ease-in-out",
                                  settings.autoGenerateTts ? "translate-x-5" : "translate-x-0"
                                )}
                              />
                            </button>
                          </div>
                        </div>

                        {/* กล่อง Toggle: Auto Merge Video */}
                        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3.5">
                              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Film className="size-5" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label
                                  htmlFor="toggle-auto-merge"
                                  className="cursor-pointer text-sm font-semibold text-foreground"
                                >
                                  รวมคลิปวิดีโอกับเสียงพากย์อัตโนมัติ (Auto Merge Video)
                                </label>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  ตัดต่อฝังเสียงพากย์ AI และลบเสียงเพลงเดิมของ Flow ออกให้อัตโนมัติทันทีที่มีทั้งไฟล์วิดีโอและไฟล์เสียง
                                  โดยใช้ FFmpeg Stream Copy ไม่สูญเสียความละเอียดภาพ
                                </p>
                              </div>
                            </div>

                            <button
                              id="toggle-auto-merge"
                              type="button"
                              role="switch"
                              aria-checked={settings.autoMergeVideo}
                              onClick={() =>
                                setSettings((s) => ({ ...s, autoMergeVideo: !s.autoMergeVideo }))
                              }
                              className={cn(
                                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                                settings.autoMergeVideo ? "bg-primary" : "bg-muted"
                              )}
                            >
                              <span
                                className={cn(
                                  "pointer-events-none inline-block size-5 transform rounded-full bg-surface shadow-sm ring-0 transition duration-200 ease-in-out",
                                  settings.autoMergeVideo ? "translate-x-5" : "translate-x-0"
                                )}
                              />
                            </button>
                          </div>
                        </div>

                        {/* การอธิบายขั้นตอน Pipeline */}
                        <div className="rounded-xl border border-border bg-surface p-4">
                          <h4 className="flex items-center gap-2 text-xs font-semibold text-foreground">
                            <Layers className="size-4 text-primary" />
                            ลำดับการทำงานแบบสองทาง (Two-Way Auto Pipeline)
                          </h4>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs text-muted-foreground">
                            <div className="rounded-lg border border-border bg-surface-2 p-3">
                              <p className="font-semibold text-foreground">1. สร้าง Prompt ก่อน</p>
                              <p className="mt-1 leading-relaxed">
                                เมื่อ Prompt เสร็จ ระบบสร้างไฟล์เสียงพากย์ทันที และหากคลิปจาก Flow มาแล้วจะรวมคลิปให้ทันที
                              </p>
                            </div>
                            <div className="rounded-lg border border-border bg-surface-2 p-3">
                              <p className="font-semibold text-foreground">2. บอท Flow เรนเดอร์คลิปก่อน</p>
                              <p className="mt-1 leading-relaxed">
                                เมื่อบอท Flow โหลดคลิป 720p/1080p ลงเครื่อง หากมีไฟล์เสียงพากย์อยู่แล้ว บอทจะทำการรวมให้ทันที
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* หมวด 2: เสียงพากย์ & ความยาว (Voice & Duration Tuning) */}
                    {activeTab === "voice" && (
                      <div className="flex flex-col gap-5">
                        <div>
                          <h3 className="text-sm sm:text-base font-bold text-foreground">
                            ปรับแต่งเสียงพากย์ &amp; ความยาวเป้าหมาย (Voice Tuning)
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                            กำหนดน้ำเสียงผู้พากย์, จำกัดระยะเวลา และเทคนิคการตัดต่อเสียงพากย์ภาษาไทย
                          </p>
                        </div>

                        {/* ความยาวเป้าหมาย */}
                        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                              <Clock className="size-4 text-primary" />
                              จำกัดความยาวเป้าหมาย (Target Duration)
                            </label>
                            <span className="font-mono text-sm font-bold text-primary">
                              {Number(settings.targetDurationSec).toFixed(1)} วินาที
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            <Input
                              type="number"
                              min={3}
                              max={30}
                              step={0.1}
                              value={settings.targetDurationSec}
                              onChange={(e) =>
                                setSettings((s) => ({
                                  ...s,
                                  targetDurationSec: parseFloat(e.target.value) || 9.6,
                                }))
                              }
                              className="h-10 w-32 text-xs font-mono"
                            />
                            <div className="flex flex-wrap items-center gap-1.5">
                              {DURATION_PRESETS.map((preset) => (
                                <button
                                  key={preset.value}
                                  type="button"
                                  onClick={() =>
                                    setSettings((s) => ({ ...s, targetDurationSec: preset.value }))
                                  }
                                  className={cn(
                                    "h-9 rounded-md px-3 text-xs font-medium transition-colors border",
                                    Math.abs(settings.targetDurationSec - preset.value) < 0.05
                                      ? "border-primary bg-primary/10 text-primary font-semibold"
                                      : "border-border-interactive/40 bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
                                  )}
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5 text-foreground font-medium">
                              <Scissors className="size-3.5 text-primary" />
                              ขั้นตอนการตัดต่ออัตโนมัติด้วย FFmpeg:
                            </div>
                            <p className="leading-relaxed">
                              ① ตัดช่วงเงียบ (Dead Air Removal) ที่ต้น-ท้าย และระหว่างประโยค (-38dB)
                            </p>
                            <p className="leading-relaxed">
                              ② หากความยาวยังเกิน {Number(settings.targetDurationSec).toFixed(1)}s ระบบจะเร่งความเร็วด้วยฟิลเตอร์ <code>atempo</code> โดยไม่ทำให้ระดับคีย์เสียงเพี้ยน
                            </p>
                          </div>
                        </div>

                        {/* เลือกเสียงผู้พากย์เริ่มต้น */}
                        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
                          <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Volume2 className="size-4 text-primary" />
                            เสียงผู้พากย์เริ่มต้น (Default Voice)
                          </label>
                          <select
                            value={settings.defaultVoice}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, defaultVoice: e.target.value }))
                            }
                            className="h-10 rounded-md border border-input bg-surface px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            {AVAILABLE_VOICES.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} — {v.desc}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* คำสั่งสไตล์เสียง */}
                        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
                          <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Sliders className="size-4 text-primary" />
                            คำสั่งสไตล์เสียง (Speech Style Prompt)
                          </label>
                          <Input
                            value={settings.defaultStyle}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, defaultStyle: e.target.value }))
                            }
                            placeholder="e.g. high energy , medium rapid fire, elongated vowels"
                            className="h-10 text-xs"
                          />
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            ส่งเข้าโมเดล Gemini เพื่อกำกับจังหวะการพูด เช่น เน้นความกระฉับกระเฉง รวดเร็ว ชัดถ้อยชัดคำ
                          </p>
                        </div>
                      </div>
                    )}

                    {/* หมวด 3: โควตางานรายวัน (Daily Quota) */}
                    {activeTab === "quota" && (
                      <div className="flex flex-col gap-5">
                        <div>
                          <h3 className="text-sm sm:text-base font-bold text-foreground">
                            โควตางานโฟลเดอร์ TTS (Daily Target Quota)
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                            ตั้งเป้าหมายจำนวนคลิปต่อวันสำหรับจัดสรรโฟลเดอร์ลงบน Desktop\TTS
                          </p>
                        </div>

                        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Calendar className="size-4 text-primary" />
                                เป้าหมายจำนวนคลิปต่อวัน (คลิป/วัน)
                              </label>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                เมื่อคลิกส่งเข้าโฟลเดอร์ TTS ระบบจะคำนวณวันโพสต์และจัดลงช่อง 1..N ตามเป้าหมายนี้
                              </p>
                            </div>

                            <Input
                              type="number"
                              min={1}
                              max={20}
                              value={settings.postsPerDay}
                              onChange={(e) =>
                                setSettings((s) => ({
                                  ...s,
                                  postsPerDay: parseInt(e.target.value, 10) || 4,
                                }))
                              }
                              className="h-10 w-24 text-center font-mono text-sm font-bold"
                            />
                          </div>

                          <div className="rounded-lg border border-border bg-surface p-3.5 text-xs text-muted-foreground">
                            <p className="font-semibold text-foreground">การทำงานของโฟลเดอร์ Desktop\TTS:</p>
                            <p className="mt-1 leading-relaxed">
                              - ระบบจะส่งไฟล์คลิปวิดีโอ (หากรวมเสียงแล้วจะใช้คลิปรวมเสียง), ภาพต้นทาง, ข้อความโพสต์, และไฟล์เสียงพากย์ <code>เสียงพากย์.wav</code>
                            </p>
                            <p className="mt-1 leading-relaxed">
                              - หากวันปัจจุบันมีครบ {settings.postsPerDay} คลิปแล้ว ระบบจะส่งไปลงในวันถัดไปโดยอัตโนมัติ
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* หมวด 4: ข้อมูลระบบ & เครื่องมือ (System Info & Diagnostics) */}
                    {activeTab === "system" && (
                      <div className="flex flex-col gap-5">
                        <div>
                          <h3 className="text-sm sm:text-base font-bold text-foreground">
                            ข้อมูลสถาปัตยกรรมระบบ &amp; เครื่องมือประมวลผล
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                            รายละเอียดเกี่ยวกับโมเดล AI, เครื่องมือมัลติมีเดีย และพื้นที่จัดเก็บข้อมูล
                          </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                              <Cpu className="size-4 text-primary" />
                              TTS Engine
                            </div>
                            <p className="text-xs font-mono font-medium text-primary">
                              gemini-3.8-flash-tts
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              สังเคราะห์เสียงภาษาไทยคุณภาพสูงด้วย Google GenAI SDK เชื่อมต่อผ่าน API Key
                            </p>
                          </div>

                          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                              <Film className="size-4 text-primary" />
                              Video Processor
                            </div>
                            <p className="text-xs font-mono font-medium text-primary">
                              FFmpeg Local Binary
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              ประมวลผลมัลติมีเดียในเครื่อง ลบเสียงเดิม ตัด Dead Air และเร่งความเร็วสปีด
                            </p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-surface p-4">
                          <h4 className="text-xs font-semibold text-foreground">การจัดเก็บบันทึกคอนฟิก:</h4>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            tts-settings.json (Server-side Flat File · No Database Migration Needed)
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                            การปรับเปลี่ยนค่าตั้งค่าทั้งหมดจะถูกบันทึกและมีผลทันที โดยไม่ต้องปิดโปรเซสหรือสั่ง build เซิร์ฟเวอร์ใหม่
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ข้อความแจ้งสถานะความสำเร็จ / Error */}
                {savedSuccess && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span>บันทึกการตั้งค่าระบบเรียบร้อยแล้ว — ค่าใหม่มีผลใช้งานทันที</span>
                  </div>
                )}

                {errorMessage && (
                  <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">
                    {errorMessage}
                  </div>
                )}
              </main>
            </div>

            {/* ส่วนท้าย Dialog (Footer Actions) */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2 px-5 py-3.5 sm:px-6">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetDefault}
                disabled={saving || loading}
                className="text-xs"
              >
                <RotateCcw className="size-3.5" />
                คืนค่าเริ่มต้น
              </Button>

              <div className="flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="text-xs"
                >
                  ปิด
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || loading}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : savedSuccess ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  {saving ? "กำลังบันทึก..." : savedSuccess ? "บันทึกแล้ว" : "บันทึกการตั้งค่า"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
