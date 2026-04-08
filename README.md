# cocapn-nexus

![Cocapn Vessel](https://img.shields.io/badge/cocapn-vessel-purple) ![License](https://img.shields.io/badge/license-MIT-blue)

**Marine robotics safety architecture, adapted for autonomous software vessels.**

Cocapn-nexus synthesizes the best ideas from [SuperInstance/nexus-runtime](https://github.com/SuperInstance/nexus-runtime) — 190K lines of battle-tested maritime robotics software — with the Cocapn fleet paradigm. Every concept is extracted, not copied. Every system runs on Cloudflare Workers with zero dependencies.

Marine robotics proved that safety, autonomy, and self-healing aren't features — they're the architecture. This vessel brings that rigor to the fleet.

## Six Systems

### 1. Reflex Executor
JSON→bytecode agent reflex system. 45 opcodes including A2A primitives (`DECLARE_INTENT`, `ASSERT_GOAL`, `TELL`, `ASK`, `DELEGATE`, `TRUST_CHECK`). Safety validator catches unsafe bytecode before execution. Deterministic cycle-count runtime.

### 2. Adaptive Autonomy
6-level scale from L0 (Manual) to L5 (Autonomous). Each level defines allowed operations, required human approval, risk tolerance, and decision authority. Transition policies enforce cooldowns and confirmation requirements. The system learns from performance at each level.

### 3. Self-Healing
Fault detection → causal graph diagnosis → recovery. Five recovery strategies: retry, reconfigure, restart, degrade, escalate. Resilience scoring tracks system health over time. The system learns which recovery strategies work best for each fault type.

### 4. Token Budget
Maps nexus power/energy management to LLM token economics. Priority-based token consumers, throttleable workloads, reserve management, load shedding by priority. Every token has a purpose. Every purpose has a budget.

### 5. Contract Marketplace
Simplified SLA terms with penalty tracking. Reputation scoring based on reliability. Bid lifecycle: post → bid → award → execute → verify → complete. Maps to Cocapn's credit system and equipment economy.

### 6. EU AI Act Classifier
Risk categorization engine for vessel compliance. Classifies vessels as unacceptable/high/limited/minimal risk. Checks transparency, human oversight, and data governance requirements. Every fleet vessel gets a compliance score.

## Synergy with Cocapn

| Nexus Concept | Cocapn Adaptation |
|---|---|
| Reflex bytecode | Equipment loading protocol |
| Autonomy levels | Captain paradigm (confidence thresholds) |
| Self-healing | Vessel Tuner + CRP-39 |
| Power budget | Token budget + credit system |
| Marketplace | Equipment economy + fleet marketplace |
| EU AI Act | Vessel compliance scoring |

## Deploy

```bash
# Fork the repo
gh repo fork Lucineer/cocapn-nexus

# Set secrets
wrangler secret put DEEPSEEK_API_KEY

# Deploy
wrangler deploy
```

## Endpoints

| Endpoint | Purpose |
|---|---|
| `/health` | Liveness check |
| `/vessel.json` | Fleet self-description |
| `/api/reflex/execute` | Run reflex bytecode |
| `/api/autonomy/level` | Get/set autonomy level |
| `/api/autonomy/transition` | Request level change |
| `/api/healing/diagnose` | Run fault diagnosis |
| `/api/budget/status` | Token budget status |
| `/api/marketplace/tasks` | Task marketplace |
| `/api/compliance/classify` | EU AI Act risk classification |

---

<i>Built with [Cocapn](https://github.com/Lucineer/cocapn-ai) — the open-source agent runtime.</i>
<i>Part of the [Lucineer fleet](https://github.com/Lucineer)</i>

Superinstance & Lucineer (DiGennaro et al.)
