/**
 * ScenarioChat — Floating chat panel for generating scenarios from natural language.
 * Uses OpenAI API to convert text → CustomScenarioDef → SceneData.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { colors, fonts } from "../theme";
import { useStore } from "../store";
import { generateScenario, getApiKey, setApiKey } from "../utils/scenarioAI";
import { generateCustomSceneData } from "../mockData";
import type { CustomScenarioDef } from "../mockData";

interface Message {
  id: number;
  role: "user" | "assistant" | "status";
  content: string;
  scenario?: CustomScenarioDef;
}

const SUGGESTIONS = [
  "A truck suddenly stops in my lane and I have to swerve",
  "A child runs out from behind a parked van",
  "Two cars collide at an intersection ahead of me",
  "A cyclist swerves into my lane to avoid a pothole",
  "Highway driving, car ahead brake-checks me",
  "Pedestrian jaywalks while I'm going 30mph",
];

export default function ScenarioChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setLocalApiKey] = useState(getApiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);

  const actions = useStore((s) => s.actions);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const addMessage = useCallback((role: Message["role"], content: string, scenario?: CustomScenarioDef) => {
    const id = ++idCounter.current;
    setMessages((prev) => [...prev, { id, role, content, scenario }]);
    return id;
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    addMessage("user", text);
    setLoading(true);

    const statusId = addMessage("status", "Thinking…");

    const { scenario, error, raw } = await generateScenario(text, (msg) => {
      setMessages((prev) => prev.map((m) => m.id === statusId ? { ...m, content: msg } : m));
    });

    // Remove status message
    setMessages((prev) => prev.filter((m) => m.id !== statusId));

    if (error) {
      addMessage("assistant", `❌ ${error}`);
      setLoading(false);
      return;
    }

    if (scenario) {
      addMessage("assistant", `✅ **${scenario.name}**\n${scenario.description}\n\n${scenario.actors.length} actors • ${scenario.severity} severity`, scenario);

      // Generate and load the scene
      try {
        const sceneData = generateCustomSceneData(scenario);
        // Set data source first, then load scene data directly (skip reset to avoid race)
        useStore.setState({
          dataSource: "scenario",
          isPlaying: false,
          customIncident: scenario.incident ? {
            startTime: scenario.incident.startTime,
            endTime: scenario.incident.endTime,
            peakTime: scenario.incident.peakTime,
            description: scenario.incident.description,
          } : null,
          customScenarioName: scenario.name,
          customSeverity: scenario.severity,
        });
        actions.setSceneData(sceneData);
        addMessage("assistant", "🎬 Scenario loaded! Press play to see it.");
      } catch (e) {
        addMessage("assistant", `❌ Failed to generate scene: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    setLoading(false);
  }, [input, loading, addMessage, actions]);

  const handleSuggestion = useCallback((text: string) => {
    setInput(text);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const saveKey = useCallback(() => {
    setApiKey(apiKey);
    setShowKeyInput(false);
  }, [apiKey]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "absolute",
          bottom: 80,
          right: 284,
          zIndex: 20,
          width: 40,
          height: 40,
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(12,15,26,0.8)",
          backdropFilter: "blur(20px)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 20px rgba(0,232,157,0.15)`,
          transition: "all 0.2s",
        }}
        title="AI Scenario Generator"
      >
        <span style={{ fontSize: 18 }}>🤖</span>
      </button>
    );
  }

  return (
    <div style={{
      position: "absolute",
      bottom: 80,
      right: 284,
      width: 370,
      maxHeight: "calc(100vh - 140px)",
      zIndex: 20,
      background: "rgba(12,15,26,0.92)",
      backdropFilter: "blur(24px)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
      fontFamily: fonts.sans,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
            Scenario AI
          </span>
          <span style={{ fontSize: 9, color: colors.textDim, fontFamily: fonts.mono }}>
            GPT-4o-mini
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setShowKeyInput((v) => !v)}
            style={{
              border: "none", background: "rgba(255,255,255,0.05)",
              borderRadius: 4, padding: "4px 6px", cursor: "pointer",
              fontSize: 10, color: colors.textDim,
            }}
          >
            🔑
          </button>
          <button
            onClick={() => setOpen(false)}
            style={{
              border: "none", background: "rgba(255,255,255,0.05)",
              borderRadius: 4, padding: "4px 8px", cursor: "pointer",
              fontSize: 12, color: colors.textDim, fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* API Key input */}
      {showKeyInput && (
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 6, alignItems: "center",
        }}>
          <input
            type="password"
            placeholder="sk-... OpenAI API key"
            value={apiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
            style={{
              flex: 1, padding: "6px 8px",
              fontSize: 11, fontFamily: fonts.mono,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4, color: colors.textPrimary,
              outline: "none",
            }}
          />
          <button
            onClick={saveKey}
            style={{
              padding: "6px 10px", fontSize: 10, fontWeight: 600,
              background: colors.accentGlow, color: colors.accent,
              border: "none", borderRadius: 4, cursor: "pointer",
            }}
          >
            Save
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 200,
          maxHeight: 400,
        }}
      >
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 11, color: colors.textDim, margin: 0, lineHeight: 1.5 }}>
              Describe any driving scenario in plain English and I'll generate it for you.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              <span style={{
                fontSize: 8, fontWeight: 700, color: colors.textDim,
                textTransform: "uppercase", letterSpacing: "1px",
              }}>
                Try these:
              </span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 10,
                    color: colors.textSecondary,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontFamily: fonts.sans,
                    transition: "all 0.15s",
                    lineHeight: 1.4,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(0,232,157,0.06)";
                    e.currentTarget.style.borderColor = `${colors.accent}30`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
                  }}
                >
                  "{s}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div style={{
              maxWidth: "85%",
              padding: "8px 12px",
              borderRadius: msg.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
              background: msg.role === "user"
                ? "rgba(0,232,157,0.12)"
                : msg.role === "status"
                  ? "rgba(0,200,219,0.08)"
                  : "rgba(255,255,255,0.04)",
              border: msg.role === "status" ? `1px solid ${colors.accentBlue}20` : "none",
              fontSize: 11,
              lineHeight: 1.5,
              color: msg.role === "status" ? colors.accentBlue : colors.textPrimary,
              fontFamily: fonts.sans,
              whiteSpace: "pre-wrap",
            }}>
              {msg.content}
              {msg.scenario && (
                <button
                  onClick={() => {
                    try {
                      const sceneData = generateCustomSceneData(msg.scenario!);
                      useStore.setState({
                        dataSource: "scenario",
                        isPlaying: false,
                        customIncident: msg.scenario!.incident ? {
                          startTime: msg.scenario!.incident.startTime,
                          endTime: msg.scenario!.incident.endTime,
                          peakTime: msg.scenario!.incident.peakTime,
                          description: msg.scenario!.incident.description,
                        } : null,
                        customScenarioName: msg.scenario!.name,
                        customSeverity: msg.scenario!.severity,
                      });
                      actions.setSceneData(sceneData);
                    } catch (_) { /* ignore */ }
                  }}
                  style={{
                    display: "block",
                    marginTop: 6,
                    padding: "4px 10px",
                    fontSize: 10,
                    fontWeight: 600,
                    background: colors.accentGlow,
                    color: colors.accent,
                    border: `1px solid ${colors.accent}30`,
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: fonts.sans,
                  }}
                >
                  ▶ Replay this scenario
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{
            display: "flex", gap: 4, padding: "4px 0",
          }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: colors.accent,
                  opacity: 0.4,
                  animation: `dotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: "10px 12px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        gap: 8,
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a scenario…"
          disabled={loading}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: fonts.sans,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            color: colors.textPrimary,
            outline: "none",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          style={{
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: fonts.sans,
            background: loading ? "rgba(255,255,255,0.04)" : `linear-gradient(135deg, ${colors.accent}, ${colors.accentBlue})`,
            color: loading ? colors.textDim : "#000",
            border: "none",
            borderRadius: 8,
            cursor: loading ? "default" : "pointer",
            transition: "all 0.15s",
          }}
        >
          {loading ? "…" : "→"}
        </button>
      </div>

      {/* Dot animation */}
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
