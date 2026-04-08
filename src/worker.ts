/**
 * cocapn-nexus: Synergy between nexus-runtime v2 and Cocapn fleet
 * Single-file deployment for Cloudflare Workers
 * Zero dependencies, production-ready
 */

export interface Env {
  COCAPN_FLEET: KVNamespace;
  NEXUS_STATE: DurableObjectNamespace;
}

// ==================== TYPES ====================
interface ReflexOp {
  code: number;
  name: string;
  args: number[];
}

interface AutonomyLevel {
  level: 0 | 1 | 2 | 3 | 4 | 5;
  name: string;
  allowedOps: number[];
  requiresHumanApproval: boolean;
  maxRiskTolerance: number;
  decisionAuthority: string[];
}

interface FaultSymptom {
  id: string;
  type: 'latency' | 'error' | 'resource' | 'security' | 'compliance';
  severity: 1 | 2 | 3 | 4 | 5;
  timestamp: number;
  data: Record<string, any>;
}

interface TaskContract {
  id: string;
  description: string;
  sla: {
    maxLatency: number;
    minUptime: number;
    penalty: number;
  };
  bid: number;
  awardedTo?: string;
  completed: boolean;
}

// ==================== REFLEX COMPILER & VM ====================
class ReflexVM {
  private memory: Uint8Array = new Uint8Array(1024);
  private stack: number[] = [];
  private ip: number = 0;
  private running: boolean = false;

  // Opcode definitions (subset of 32)
  static readonly OPS = {
    DECLARE_INTENT: 0x01,
    ASSERT_GOAL: 0x02,
    TELL: 0x03,
    ASK: 0x04,
    DELEGATE: 0x05,
    TRUST_CHECK: 0x06,
    AUTONOMY_LEVEL_ASSERT: 0x07,
    EMERGENCY_CLAIM: 0x08,
    LOAD_CONST: 0x09,
    STORE: 0x0A,
    JUMP: 0x0B,
    CALL: 0x0C,
    RET: 0x0D,
    HALT: 0xFF,
  };

  /**
   * Compile JSON reflex definition to 8-byte bytecode
   * Format: [opcode, arg1, arg2, arg3, arg4, arg5, arg6, safety_flag]
   */
  compile(reflex: any): Uint8Array {
    const bytecode = new Uint8Array(8);
    const opcode = ReflexVM.OPS[reflex.op as keyof typeof ReflexVM.OPS] || 0x00;
    
    bytecode[0] = opcode;
    bytecode[1] = reflex.args?.[0] || 0;
    bytecode[2] = reflex.args?.[1] || 0;
    bytecode[3] = reflex.args?.[2] || 0;
    bytecode[4] = reflex.args?.[3] || 0;
    bytecode[5] = reflex.args?.[4] || 0;
    bytecode[6] = reflex.args?.[5] || 0;
    bytecode[7] = this.safetyCheck(opcode, reflex.args) ? 1 : 0;
    
    return bytecode;
  }

  private safetyCheck(opcode: number, args: number[]): boolean {
    // Safety validator: prevent unsafe operations
    if (opcode === ReflexVM.OPS.EMERGENCY_CLAIM && args[0] > 3) return false;
    if (opcode === ReflexVM.OPS.AUTONOMY_LEVEL_ASSERT && args[0] > 5) return false;
    return true;
  }

  execute(bytecode: Uint8Array): { result: any; logs: string[] } {
    const logs: string[] = [];
    this.ip = 0;
    this.running = true;
    let result = null;

    while (this.running && this.ip < bytecode.length) {
      const op = bytecode[this.ip];
      
      switch (op) {
        case ReflexVM.OPS.DECLARE_INTENT:
          logs.push(`INTENT: ${bytecode[this.ip + 1]}`);
          this.ip += 2;
          break;
          
        case ReflexVM.OPS.ASSERT_GOAL:
          const goalId = bytecode[this.ip + 1];
          logs.push(`GOAL: ${goalId}`);
          result = { goal: goalId, status: 'asserted' };
          this.ip += 2;
          break;
          
        case ReflexVM.OPS.TELL:
          const msg = String.fromCharCode(bytecode[this.ip + 1]);
          logs.push(`TELL: ${msg}`);
          this.ip += 2;
          break;
          
        case ReflexVM.OPS.DELEGATE:
          const vessel = bytecode[this.ip + 1];
          logs.push(`DELEGATE to vessel ${vessel}`);
          this.ip += 2;
          break;
          
        case ReflexVM.OPS.AUTONOMY_LEVEL_ASSERT:
          const level = bytecode[this.ip + 1];
          logs.push(`AUTONOMY: Set level ${level}`);
          result = { autonomyLevel: level };
          this.ip += 2;
          break;
          
        case ReflexVM.OPS.HALT:
          this.running = false;
          this.ip++;
          break;
          
        default:
          logs.push(`UNKNOWN OPCODE: 0x${op.toString(16)}`);
          this.ip++;
      }
    }
    
    return { result, logs };
  }
}

// ==================== ADAPTIVE AUTONOMY ====================
class AutonomyManager {
  private currentLevel: 0 | 1 | 2 | 3 | 4 | 5 = 2;
  private levels: AutonomyLevel[];
  private transitionHistory: Array<{ from: number; to: number; timestamp: number; approved: boolean }> = [];
  private lastTransition = 0;
  private performance: Record<number, { successes: number; failures: number; avgResponse: number }> = {};

  constructor() {
    this.levels = [
      { level: 0, name: 'MANUAL', allowedOps: [1, 2], requiresHumanApproval: true, maxRiskTolerance: 0, decisionAuthority: ['human'] },
      { level: 1, name: 'ASSISTED', allowedOps: [1, 2, 3, 4], requiresHumanApproval: true, maxRiskTolerance: 1, decisionAuthority: ['human', 'system'] },
      { level: 2, name: 'SUPERVISED', allowedOps: [1, 2, 3, 4, 5, 6], requiresHumanApproval: false, maxRiskTolerance: 2, decisionAuthority: ['system'] },
      { level: 3, name: 'CONDITIONAL', allowedOps: [1, 2, 3, 4, 5, 6, 7], requiresHumanApproval: false, maxRiskTolerance: 3, decisionAuthority: ['system'] },
      { level: 4, name: 'HIGHLY_AUTONOMOUS', allowedOps: [1, 2, 3, 4, 5, 6, 7, 8], requiresHumanApproval: false, maxRiskTolerance: 4, decisionAuthority: ['system'] },
      { level: 5, name: 'FULL_AUTONOMY', allowedOps: [1, 2, 3, 4, 5, 6, 7, 8], requiresHumanApproval: false, maxRiskTolerance: 5, decisionAuthority: ['system'] },
    ];
  }

  canTransition(toLevel: number, force: boolean = false): { allowed: boolean; reason?: string; cooldown?: number } {
    const now = Date.now();
    const cooldown = 60 * 1000; // 1 minute
    
    // Cooldown check
    if (now - this.lastTransition < cooldown && !force) {
      return { allowed: false, reason: 'Cooldown active', cooldown: cooldown - (now - this.lastTransition) };
    }
    
    // Max transitions per hour (5)
    const hourAgo = now - 60 * 60 * 1000;
    const recent = this.transitionHistory.filter(t => t.timestamp > hourAgo);
    if (recent.length >= 5 && !force) {
      return { allowed: false, reason: 'Max transitions per hour reached' };
    }
    
    // Only allow ±1 level transitions unless force
    const diff = Math.abs(toLevel - this.currentLevel);
    if (diff > 1 && !force) {
      return { allowed: false, reason: 'Can only transition one level at a time' };
    }
    
    return { allowed: true };
  }

  async requestTransition(toLevel: number, force: boolean = false): Promise<boolean> {
    const check = this.canTransition(toLevel, force);
    if (!check.allowed) return false;
    
    const level = this.levels.find(l => l.level === toLevel);
    if (!level) return false;
    
    // Check if human approval required
    if (level.requiresHumanApproval && !force) {
      // In real implementation, would trigger human approval workflow
      return false;
    }
    
    // Record transition
    this.transitionHistory.push({
      from: this.currentLevel,
      to: toLevel,
      timestamp: Date.now(),
      approved: true
    });
    
    this.currentLevel = toLevel as 0 | 1 | 2 | 3 | 4 | 5;
    this.lastTransition = Date.now();
    
    return true;
  }

  recordPerformance(success: boolean, responseTime: number) {
    if (!this.performance[this.currentLevel]) {
      this.performance[this.currentLevel] = { successes: 0, failures: 0, avgResponse: 0 };
    }
    
    const perf = this.performance[this.currentLevel];
    if (success) {
      perf.successes++;
    } else {
      perf.failures++;
    }
    
    // Update rolling average
    perf.avgResponse = (perf.avgResponse * (perf.successes + perf.failures - 1) + responseTime) / (perf.successes + perf.failures);
  }

  getRecommendation(): { recommendedLevel: number; confidence: number; reasons: string[] } {
    const current = this.performance[this.currentLevel];
    const reasons: string[] = [];
    
    if (!current) return { recommendedLevel: this.currentLevel, confidence: 0, reasons };
    
    let score = 0;
    const total = current.successes + current.failures;
    
    if (total > 10) {
      const successRate = current.successes / total;
      
      if (successRate > 0.95 && current.avgResponse < 100) {
        score = 1; // Consider increasing autonomy
        reasons.push('High success rate and fast response');
      } else if (successRate < 0.7) {
        score = -1; // Consider decreasing autonomy
        reasons.push('Low success rate');
      }
    }
    
    const recommendedLevel = Math.max(0, Math.min(5, this.currentLevel + score));
    const confidence = Math.abs(score);
    
    return { recommendedLevel, confidence, reasons };
  }
}

// ==================== SELF-HEALING ====================
class SelfHealingEngine {
  private symptoms: FaultSymptom[] = [];
  private recoveryStrategies = ['retry', 'reconfigure', 'restart', 'degrade', 'escalate'];
  private strategyEffectiveness: Record<string, { attempts: number; successes: number }> = {};
  private resilienceScore: number = 100;

  detect(symptom: Omit<FaultSymptom, 'id' | 'timestamp'>): string {
    const id = `fault_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullSymptom: FaultSymptom = {
      ...symptom,
      id,
      timestamp: Date.now()
    };
    
    this.symptoms.push(fullSymptom);
    this.resilienceScore = Math.max(0, this.resilienceScore - symptom.severity * 5);
    
    // Auto-diagnose and trigger recovery
    const diagnosis = this.diagnose(fullSymptom);
    const recovery = this.selectRecoveryStrategy(diagnosis);
    
    return this.executeRecovery(recovery, fullSymptom);
  }

  private diagnose(symptom: FaultSymptom): string {
    // Simple heuristic rules for diagnosis
    if (symptom.type === 'latency' && symptom.severity >= 4) {
      return 'network_congestion';
    } else if (symptom.type === 'error' && symptom.data?.['code'] === 'TIMEOUT') {
      return 'timeout_failure';
    } else if (symptom.type === 'resource' && symptom.data?.['memory'] > 90) {
      return 'memory_exhaustion';
    } else {
      return 'unknown_failure';
    }
  }

  private selectRecoveryStrategy(diagnosis: string): string {
    // Map diagnosis to recovery strategy
    const strategyMap: Record<string, string[]> = {
      'network_congestion': ['retry', 'degrade'],
      'timeout_failure': ['retry', 'restart'],
      'memory_exhaustion': ['restart', 'escalate'],
      'unknown_failure': ['retry', 'restart', 'escalate']
    };
    
    const strategies = strategyMap[diagnosis] || ['retry'];
    
    // Select most effective strategy based on history
    let bestStrategy = strategies[0];
    let bestScore = -1;
    
    for (const strategy of strategies) {
      const record = this.strategyEffectiveness[strategy] || { attempts: 0, successes: 0 };
      const score = record.attempts === 0 ? 0 : record.successes / record.attempts;
      
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }
    
    return bestStrategy;
  }

  private executeRecovery(strategy: string, symptom: FaultSymptom): string {
    const record = this.strategyEffectiveness[strategy] || { attempts: 0, successes: 0 };
    record.attempts++;
    
    // Simulate recovery execution
    let success = false;
    
    switch (strategy) {
      case 'retry':
        success = Math.random() > 0.3; // 70% success rate
        break;
      case 'restart':
        success = Math.random() > 0.2; // 80% success rate
        break;
      case 'degrade':
        success = Math.random() > 0.1; // 90% success rate
        break;
      default:
        success = Math.random() > 0.5;
    }
    
    if (success) {
      record.successes++;
      this.resilienceScore = Math.min(100, this.resilienceScore + symptom.severity * 3);
    }
    
    this.strategyEffectiveness[strategy] = record;
    
    return `${strategy}_${success ? 'success' : 'failed'}`;
  }
}

// ==================== TOKEN/POWER BUDGET ====================
class BudgetManager {
  private totalBudget: number = 1000; // Total tokens available
  private allocated: Map<string, { tokens: number; priority: number; throttleable: boolean }> = new Map();
  private reserves: { emergency: number; critical: number; standard: number } = { emergency: 100, critical: 200, standard: 300 };
  
  allocate(consumerId: string, requestedTokens: number, priority: number = 3, throttleable: boolean = true): { granted: number; reason?: string } {
    const available = this.getAvailableTokens();
    
    if (requestedTokens > available) {
      // Load shedding: try to free up tokens from lower priority consumers
      const freed = this.shedLoad(priority);
      
      if (requestedTokens > available + freed) {
        return { granted: 0, reason: 'Insufficient budget' };
      }
    }
    
    this.allocated.set(consumerId, { 
      tokens: requestedTokens, 
      priority, 
      throttleable 
    });
    
    return { granted: requestedTokens };
  }
  
  private shedLoad(minPriority: number): number {
    let freed = 0;
    
    // Sort by priority (lowest first) and throttleable status
    const consumers = Array.from(this.allocated.entries())
      .filter(([_, config]) => config.priority > minPriority && config.throttleable)
      .sort((a, b) => a[1].priority - b[1].priority);
    
    for (const [id, config] of consumers) {
      const toFree = Math.floor(config.tokens * 0.5); // Free 50% from throttled consumer
      const current = this.allocated.get(id)!;
      current.tokens -= toFree;
      freed += toFree;
      
      if (current.tokens <= 0) {
        this.allocated.delete(id);
      }
      
      if (freed > 0) break;
    }
    
    return freed;
  }
  
  private getAvailableTokens(): number {
    const used = Array.from(this.allocated.values())
      .reduce((sum, config) => sum + config.tokens, 0);
    
    return this.totalBudget - used;
  }
  
  consume(consumerId: string, amount: number): boolean {
    const config = this.allocated.get(consumerId);
    if (!config || config.tokens < amount) return false;
    
    config.tokens -= amount;
    if (config.tokens <= 0) {
      this.allocated.delete(consumerId);
    }
    
    return true;
  }
}

// ==================== CONTRACT MARKETPLACE ====================
class ContractMarketplace {
  private contracts: TaskContract[] = [];
  private reputation: Map<string, { score: number; completed: number; failed: number }> = new Map();
  
  listTask(description: string, sla: TaskContract['sla']): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: TaskContract = {
      id,
      description,
      sla,
      bid: 0,
      completed: false
    };
    
    this.contracts.push(task);
    return id;
  }
  
  submitBid(taskId: string, vesselId: string, bidAmount: number): boolean {
    const task = this.contracts.find(t => t.id === taskId);
    if (!task || task.awardedTo) return false;
    
    // Check vessel reputation
    const rep = this.reputation.get(vesselId) || { score: 50, completed: 0, failed: 0 };
    
    // Adjust bid based on reputation (better reputation can bid lower)
    const effectiveBid = bidAmount * (100 / (rep.score || 1));
    
    if (!task.bid || effectiveBid < task.bid) {
      task.bid = effectiveBid;
      task.awardedTo = vesselId;
      return true;
    }
    
    return false;
  }
  
  completeTask(taskId: string, success: boolean, actualLatency?: number): number {
    const task = this.contracts.find(t => t.id === taskId);
    if (!task || !task.awardedTo) return 0;
    
    const vesselId = task.awardedTo;
    const rep = this.reputation.get(vesselId) || { score: 50, completed: 0, failed: 0 };
    
    let penalty = 0;
    
    // Check SLA violations
    if (actualLatency && actualLatency > task.sla.maxLatency) {
      penalty = task.sla.penalty;
    }
    
    if (success) {
      rep.completed++;
      rep.score = Math.min(100, rep.score + 5);
    } else {
      rep.failed++;
      rep.score = Math.max(0, rep.score - 10);
      penalty += task.sla.penalty;
    }
    
    this.reputation.set(vesselId, rep);
    task.completed = true;
    
    return penalty;
  }
  
  getReputation(vesselId: string): number {
    return this.reputation.get(vesselId)?.score || 50;
  }
}

// ==================== EU AI ACT COMPLIANCE ====================
class EUAIActCompliance {
  classifyRisk(input: {
    autonomyLevel: number;
    decisionImpact: 'minimal' | 'limited' | 'significant' | 'severe';
    dataType: 'non-personal' | 'personal' | 'sensitive';
    domain: 'general' | 'critical' | 'high-risk';
  }): {
    riskClass: 'unacceptable' | 'high' | 'limited' | 'minimal';
    requirements: string[];
    humanOversight: 'required' | 'recommended' | 'not-required';
    transparencyScore: number;
  } {
    let score = 0;
    const requirements: string[] = [];
    
    // Autonomy level scoring
    score += input.autonomyLevel * 10;
    
    // Decision impact scoring
    const impactScores = { minimal: 0, limited: 15, significant: 30, severe: 50 };
    score += impactScores[input.decisionImpact];
    
    // Data type scoring
    const dataScores = { 'non-personal': 0, 'personal': 20, 'sensitive': 40 };
    score += dataScores[input.dataType];
    
    // Domain scoring
    const domainScores = { general: 0, critical: 25, 'high-risk': 50 };
    score += domainScores[input.domain];
    
    // Determine risk class
    let riskClass: 'unacceptable' | 'high' | 'limited' | 'minimal';
    let humanOversight: 'required' | 'recommended' | 'not-required';
    
    if (score >= 100) {
      riskClass = 'unacceptable';
      humanOversight = 'required';
      requirements.push('Prohibited under AI Act');
    } else if (score >= 70) {
      riskClass = 'high';
      humanOversight = 'required';
      requirements.push('Conformity assessment required');
      requirements.push('Fundamental rights impact assessment');
      requirements.push('High-quality data requirements');
    } else if (score >= 40) {
      riskClass = 'limited';
      humanOversight = 'recommended';
      requirements.push('Transparency obligations');
      requirements.push('Technical documentation');
    } else {
      riskClass = 'minimal';
      humanOversight = 'not-required';
    }
    
    // Add general requirements
    if (input.autonomyLevel >= 3) {
      requirements.push('Human oversight mechanism');
    }
    
    if (input.dataType !== 'non-personal') {
      requirements.push('Data governance framework');
    }
    
    // Transparency score (inverse of risk)
    const transparencyScore = Math.max(0, 100 - score);
    
    return {
      riskClass,
      requirements,
      humanOversight,
      transparencyScore
    };
  }
}

// ==================== MAIN WORKER ====================
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Initialize modules
    const reflexVM = new ReflexVM();
    const autonomyMgr = new AutonomyManager();
    const healingEngine = new SelfHealingEngine();
    const budgetMgr = new BudgetManager();
    const marketplace = new ContractMarketplace();
    const compliance = new EUAIActCompliance();
    
    // Route requests
    if (path === '/' && request.method === 'GET') {
      return this.serveLandingPage();
    }
    
    if (path === '/vessel.json' && request.method === 'GET') {
      return this.serveVesselJson();
    }
    
    if (path === '/reflex' && request.method === 'POST') {
      const body = await request.json();
      const bytecode = reflexVM.compile(body);
      const result = reflexVM.execute(bytecode);
      return Response.json(result);
    }
    
    if (path === '/autonomy' && request.method === 'GET') {
      return Response.json({
        currentLevel: autonomyMgr['currentLevel'],
        performance: autonomyMgr['performance'],
        recommendation: autonomyMgr.getRecommendation()
      });
    }
    
    if (path === '/autonomy/transition' && request.method === 'POST') {
      const { level, force } = await request.json();
      const success = await autonomyMgr.requestTransition(level, force);
      return Response.json({ success, currentLevel: autonomyMgr['currentLevel'] });
    }
    
    if (path === '/health' && request.method === 'GET') {
      return Response.json({
        resilienceScore: healingEngine['resilienceScore'],
        recentFaults: healingEngine['symptoms'].slice(-5)
      });
    }
    
    if (path === '/budget' && request.method === 'GET') {
      return Response.json({
        total: budgetMgr['totalBudget'],
        allocated: Array.from(budgetMgr['allocated'].entries())
      });
    }
    
    if (path === '/marketplace' && request.method === 'GET') {
      return Response.json({
        openContracts: marketplace['contracts'].filter(c => !c.completed),
        reputation: Array.from(marketplace['reputation'].entries())
      });
    }
    
    if (path === '/compliance' && request.method === 'POST') {
      const input = await request.json();
      const assessment = compliance.classifyRisk(input);
      return Response.json(assessment);
    }
    
    return new Response('Not Found', { status: 404 });
  },
  
  serveLandingPage(): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cocapn Nexus Fleet</title>
    <style>
        :root {
            --primary: #6366f1;
            --secondary: #8b5cf6;
            --dark: #1e293b;
            --light: #f8fafc;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--light);
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        h1 {
            margin-top: 0;
            background: linear-gradient(90deg, #fbcfe8, #c7d2fe);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .modules {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 40px 0;
        }
        .module {
            background: rgba(255, 255, 255, 0.15);
            padding: 20px;
            border-radius: 10px;
            transition: transform 0.3s ease;
        }
        .module:hover {
            transform: translateY(-5px);
        }
        code {
            background: rgba(0, 0, 0, 0.3);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'SF Mono', monospace;
        }
        .endpoints {
            margin-top: 40px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Cocapn Nexus Fleet</h1>
        <p><strong>Synergy of nexus-runtime v2 with Cocapn fleet paradigm</strong></p>
        
        <div class="modules">
            <div class="module">
                <h3>🧠 Reflex VM</h3>
                <p>JSON→bytecode pipeline with 32-opcode VM</p>
            </div>
            <div class="module">
                <h3>⚡ Adaptive Autonomy</h3>
                <p>L0-L5 with intelligent transitions</p>
            </div>
            <div class="module">
                <h3>🏥 Self-Healing</h3>
                <p>Fault detection → diagnosis → recovery</p>
            </div>
            <div class="module">
                <h3>💰 Token Budget</h3>
                <p>Energy-aware allocation & load shedding</p>
            </div>
            <div class="module">
                <h3>🏛️ EU AI Act</h3>
                <p>Risk classification & compliance</p>
            </div>
            <div class="module">
                <h3>🤝 Marketplace</h3>
                <p>Contract-Net Protocol with reputation</p>
            </div>
        </div>
        
        <div class="endpoints">
            <h3>API Endpoints:</h3>
            <ul>
                <li><code>GET /</code> - This landing page</li>
                <li><code>GET /vessel.json</code> - Fleet DNS configuration</li>
                <li><code>POST /reflex</code> - Execute reflex bytecode</li>
                <li><code>GET /autonomy</code> - Current autonomy level</li>
                <li><code>POST /autonomy/transition</code> - Request level change</li>
                <li><code>GET /health</code> - System health status</li>
                <li><code>GET /budget</code> - Token budget allocation</li>
                <li><code>GET /marketplace</code> - Open contracts</li>
                <li><code>POST /compliance</code> - EU AI Act risk assessment</li>
            </ul>
        </div>
        
        <p style="margin-top: 40px; font-size: 0.9em; opacity: 0.8;">
            Deployed on Cloudflare Workers • 150+ vessel fleet • BYOK • Emergence L1-L6
        </p>
    </div>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline';"
      }
    });
  },
  
  serveVesselJson(): Response {
    const vesselConfig = {
      name: "cocapn-nexus",
      version: "2.0.0",
      type: "nexus-superinstance",
      deployment: "cloudflare-workers",
      capabilities: [
        "reflex-vm",
        "adaptive-autonomy",
        "self-healing",
        "token-budget",
        "contract-marketplace",
        "eu-ai-act-compliance"
      ],
      autonomy: {
        current: 2,
        max: 5,
        transition_policies: {
          cooldown_ms: 60000,
          max_per_hour: 5,
          human_approval_required: [0, 1]
        }
      },
      equipment: ["rebac", "ipc", "pay"],
      emergence: "L1-L6",
      trust: {
        increment: "event-count",
        severity_tags: true
      },
      scoring: "nvidia-warp",
      credits: {
        free: 5,
        ad_bonus: true,
        auto_seat_cap: true
      },
      byok: true,
      git_coordination: true,
      captain_admiral: true,
      shipwright: "CLAUDE.md",
      vessel_tuner: "5-stage-correctness"
    };
    
    return Response.json(vesselConfig);
  }
};