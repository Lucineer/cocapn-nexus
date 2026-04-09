# Round 1: nexus-core-architecture

**Model**: deepseek-chat

---

# Cocapn Nexus Runtime Core for Cloudflare Workers

## Executive Architecture Overview

Cocapn Nexus is a distributed event-driven runtime designed for Cloudflare Workers' constraints, implementing a unified communication fabric across Agent-to-Agent (A2A), Agent-to-UI (A2UI), Agent-to-Client (A2C), and Model Context Protocol (MCP) patterns. The runtime operates within strict boundaries: 30-second CPU limits, 128MB memory, and global distribution requirements.

## Core Architecture Principles

```typescript
/**
 * Cocapn Nexus operates on three fundamental principles:
 * 1. Ephemeral Persistence: State exists in layered memory with automatic promotion/demotion
 * 2. Event-First Design: All interactions are modeled as typed events with causal chains
 * 3. Themed Isolation: Each deployment theme (studylog, dmlog, etc.) runs in isolated runtime contexts
 */

interface NexusCorePrinciples {
  readonly maxCPUMilliseconds: 30000;
  readonly maxMemoryBytes: 134217728;
  readonly maxWebSocketConnections: 100000;
  readonly eventLoopTickMs: 10;
  readonly sessionGracePeriodMs: 300000; // 5 minutes
}
```

## Event Loop Design: Quantum Scheduler

```typescript
/**
 * Quantum Event Loop: Tick-based scheduler with priority queues
 * Each quantum processes events based on type and priority
 */
interface EventQuantum {
  timestamp: number;
  quantumId: string;
  events: NexusEvent[];
  processingBudgetMs: number;
}

class NexusEventLoop {
  private readonly priorityQueues: Map<EventPriority, Array<NexusEvent>>;
  private readonly quantumSize: number = 50; // events per quantum
  private currentTick: number = 0;
  
  // Three-tier priority system
  private readonly priorities = {
    CRITICAL: 0,    // Real-time responses, WebSocket messages
    HIGH: 1,        // User interactions, session management
    NORMAL: 2,      // Background processing, analytics
    BACKGROUND: 3   // Logging, telemetry
  } as const;

  async processQuantum(): Promise<void> {
    const startTime = Date.now();
    const quantum: EventQuantum = {
      timestamp: Date.now(),
      quantumId: `quantum-${this.currentTick}-${crypto.randomUUID().slice(0, 8)}`,
      events: [],
      processingBudgetMs: 100 // Max 100ms per quantum
    };

    // Fill quantum from priority queues
    for (const priority of [0, 1, 2, 3]) {
      const queue = this.priorityQueues.get(priority as EventPriority);
      if (queue && queue.length > 0) {
        const sliceSize = Math.min(
          this.quantumSize - quantum.events.length,
          Math.ceil(queue.length * (1 / (priority + 1))) // Priority weighting
        );
        quantum.events.push(...queue.splice(0, sliceSize));
        if (quantum.events.length >= this.quantumSize) break;
      }
    }

    // Process events with cooperative yielding
    for (const event of quantum.events) {
      if (Date.now() - startTime > quantum.processingBudgetMs) {
        // Yield control, reschedule remaining events
        this.scheduleEvent(event, event.priority);
        continue;
      }
      await this.processEvent(event);
    }

    this.currentTick++;
  }

  private async processEvent(event: NexusEvent): Promise<void> {
    // Event processing with timeout protection
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 5000);

    try {
      await Promise.race([
        event.handler(event.payload, timeoutController.signal),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Event processing timeout')), 5000)
        )
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

## Session Management: Ephemeral State Machine

```typescript
/**
 * Three-layer session management with automatic promotion/demotion
 * Layer 1: In-memory (hot sessions, < 5min idle)
 * Layer 2: KV storage (warm sessions, < 30min idle)
 * Layer 3: Git-backed (cold sessions, archival)
 */
interface NexusSession {
  sessionId: string;
  userId: string;
  theme: DeploymentTheme;
  createdAt: number;
  lastAccessed: number;
  ttl: number;
  state: SessionState;
  memoryLayer: 1 | 2 | 3;
  context: SessionContext;
}

class SessionManager {
  private readonly memoryCache = new Map<string, NexusSession>();
  private readonly kvNamespace: KVNamespace;
  private readonly gitBackend: GitStorage;
  
  // Session state transitions
  private readonly stateMachine: Record<SessionState, SessionState[]> = {
    'CREATING': ['ACTIVE', 'ERROR'],
    'ACTIVE': ['PAUSED', 'TERMINATING', 'ERROR'],
    'PAUSED': ['ACTIVE', 'TERMINATING'],
    'TERMINATING': ['ARCHIVED', 'ERROR'],
    'ARCHIVED': [],
    'ERROR': ['RECOVERING', 'ARCHIVED']
  };

  async getOrCreateSession(
    userId: string,
    theme: DeploymentTheme,
    context?: Partial<SessionContext>
  ): Promise<NexusSession> {
    const sessionKey = `${theme}:${userId}`;
    
    // Check memory layer first
    let session = this.memoryCache.get(sessionKey);
    
    if (!session) {
      // Check KV layer
      const kvSession = await this.kvNamespace.get(sessionKey, 'json');
      if (kvSession) {
        session = kvSession as NexusSession;
        session.memoryLayer = 2;
        // Promote to memory if recently accessed
        if (Date.now() - session.lastAccessed < 300000) {
          this.memoryCache.set(sessionKey, session);
          session.memoryLayer = 1;
        }
      } else {
        // Create new session
        session = await this.createSession(userId, theme, context);
      }
    }
    
    session.lastAccessed = Date.now();
    return session;
  }

  private async createSession(
    userId: string,
    theme: DeploymentTheme,
    context?: Partial<SessionContext>
  ): Promise<NexusSession> {
    const session: NexusSession = {
      sessionId: crypto.randomUUID(),
      userId,
      theme,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      ttl: 3600, // 1 hour default
      state: 'CREATING',
      memoryLayer: 1,
      context: {
        ...context,
        capabilities: this.getThemeCapabilities(theme),
        memoryQuota: this.calculateMemoryQuota(theme)
      }
    };

    this.memoryCache.set(`${theme}:${userId}`, session);
    
    // Async persistence to KV with eventual consistency
    this.persistSession(session).catch(console.error);
    
    return session;
  }

  private async persistSession(session: NexusSession): Promise<void> {
    // Write to KV with appropriate TTL
    await this.kvNamespace.put(
      `${session.theme}:${session.userId}`,
      JSON.stringify(session),
      { expirationTtl: session.ttl }
    );
    
    // Archive to git if session is terminating
    if (session.state === 'TERMINATING') {
      await this.gitBackend.archiveSession(session);
    }
  }
}
```

## BYOK (Bring Your Own Key) Model Routing

```typescript
/**
 * Dynamic model routing with provider abstraction
 * Supports OpenAI, Anthropic, Cohere, Local, and Custom providers
 */
interface ModelProvider {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  rateLimit: RateLimitConfig;
  costPerToken: number;
  endpoint: string;
}

interface ModelRoute {
  modelId: string;
  provider: ModelProvider;
  fallbacks: string[]; // Fallback model IDs
  routingStrategy: 'latency' | 'cost' | 'quality' | 'hybrid';
  contextWindow: number;
}

class ModelRouter {
  private readonly providers: Map<string, ModelProvider> = new Map();
  private readonly routes: Map<string, ModelRoute> = new Map();
  private readonly latencyMetrics: Map<string, number[]> = new Map();
  
  async routeRequest(
    request: ModelRequest,
    session: NexusSession
  ): Promise<ModelResponse> {
    const route = this.resolveRoute(request, session);
    
    // Apply BYOK: Use session-specific API keys if provided
    const apiKey = await this.resolveAPIKey(session, route.provider);
    
    // Select optimal endpoint based on routing strategy
    const endpoint = this.selectEndpoint(route, request);
    
    // Execute with fallback support
    return this.executeWithFallbacks(request, route, apiKey, endpoint);
  }

  private resolveRoute(request: ModelRequest, session: NexusSession): ModelRoute {
    // Theme-specific model configuration
    const themeConfig = this.getThemeModelConfig(session.theme);
    
    // Session-specific overrides
    const sessionModel = session.context?.preferredModel;
    
    // Dynamic routing based on request type
    const modelId = sessionModel || 
                   this.selectModelByRequestType(request.type) ||
                   themeConfig.defaultModel;
    
    const route = this.routes.get(modelId);
    if (!route) {
      throw new Error(`No route found for model: ${modelId}`);
    }
    
    return route;
  }

  private async resolveAPIKey(
    session: NexusSession,
    provider: ModelProvider
  ): Promise<string> {
    // Check for BYOK in session context
    const byokKey = session.context?.apiKeys?.[provider.id];
    if (byokKey) {
      return byokKey;
    }
    
    // Use runtime default key with quota management
    return await this.getRuntimeAPIKey(provider.id);
  }

  private selectEndpoint(route: ModelRoute, request: ModelRequest): string {
    const strategy = route.routingStrategy;
    const endpoints = this.getProviderEndpoints(route.provider.id);
    
    switch (strategy) {
      case 'latency':
        return endpoints.sort((a, b) => 
          this.getAverageLatency(a) - this.getAverageLatency(b)
        )[0];
      
      case 'cost':
        // Select endpoint in lowest-cost region
        return endpoints.filter(e => e.region === 'us-east-1')[0];
      
      case 'quality':
        // Select endpoint with highest success rate
        return endpoints.sort((a, b) => 
          this.getSuccessRate(b) - this.getSuccessRate(a)
        )[0];
      
      case 'hybrid':
        // Weighted score based on multiple factors
        return endpoints.sort((a, b) => 
          this.calculateEndpointScore(b, request) - 
          this.calculateEndpointScore(a, request)
        )[0];
    }
  }
}
```

## Streaming SSE (Server-Sent Events) with Backpressure

```typescript
/**
 * Efficient SSE implementation with backpressure control and reconnection support
 */
class NexusSSEStream {
  private readonly encoder = new TextEncoder();
  private readonly streams = new Map<string, ReadableStream>();
  private readonly controllerQueue = new Map<string, ReadableStreamDefaultController>();
  
  createStream(sessionId: string, channel: string): ReadableStream {
    const streamId = `${sessionId}:${channel}`;
    
    if (this.streams.has(streamId)) {
      return this.streams.get(streamId)!;
    }
    
    const stream = new ReadableStream({
      start: (controller) => {
        this.controllerQueue.set(streamId, controller);
        
        // Send initial keepalive
        this.sendEvent(streamId, {
          type: 'stream:init',
          data: { streamId, timestamp: Date.now() }
        });
      },
      
      cancel: () => {
        this.controllerQueue.delete(streamId);
        this.streams.delete(streamId);
      }
    });
    
    this.streams.set(streamId, stream);
    return stream;
  }
  
  async sendEvent(
    streamId: string, 
    event: StreamEvent,
    options: { retryMs?: number } = {}
  ): Promise<boolean> {
    const controller = this.controllerQueue.get(streamId);
    if (!controller) {
      return false;
    }
    
    try {
      const message = this.formatSSEMessage(event, options);
      controller.enqueue(this.encoder.encode(message));
      return true;
    } catch (error) {
      // Handle backpressure - queue message for retry
      await this.queueForRetry(streamId, event, options);
      return false;
    }
  }
  
  private formatSSEMessage(
    event: StreamEvent,
    options: { retryMs?: number }
  ): string {
    let message = '';
    
    if (options.retryMs) {
      message += `retry: ${options.retryMs}\n`;
    }
    
    if (event.id) {
      message += `id: ${event.id}\n`;
    }
    
    if (event.type) {
      message += `event: ${event.type}\n`;
    }
    
    // JSON data with newline handling
    const data = typeof event.data === 'string' 
      ? event.data 
      : JSON.stringify(event.data);
    
    message += `data: ${data.replace(/\n/g, '\ndata: ')}\n\n`;
    
    return message;
  }
  
  // Backpressure management
  private async queueForRetry(
    streamId: string,
    event: StreamEvent,
    options: { retryMs?: number }
  ): Promise<void> {
    const backoff = new ExponentialBackoff({
      initialDelay: 100,
      maxDelay: 5000,
      maxAttempts: 5
    });
    
    for await (const delay of backoff) {
      const success = await this.sendEvent(streamId, event, {
        ...options,
        retryMs: delay
      });
      
      if (success) break;
    }
  }
}
```

## Themed Instance Pattern

```typescript
/**
 * Theme-specific runtime configuration and isolation
 * Each theme gets its own optimized runtime configuration
 */
type DeploymentTheme = 'studylog' | 'dmlog' | 'research' | 'creative' | 'enterprise';

interface ThemeConfig {
  id: DeploymentTheme;
  memoryAllocation: {
    sessionMemory: number;    // MB
    kvStorage: number;        // MB
    gitArchive: number;       // MB
  };
  capabilities: ThemeCapability[];
  modelPreferences: ModelPreference[];
  uiComponents: UIComponentConfig[];
  analytics: AnalyticsConfig;
}

class ThemeRuntime {
  private readonly configs: Map<DeploymentTheme, ThemeConfig> = new Map();
  
  constructor() {
    this.initializeThemes();
  }
  
  private initializeThemes(): void {
    // StudyLog: Optimized for learning and knowledge tracking
    this.configs.set('studylog', {
      id: 'studylog',
      memoryAllocation: {
        sessionMemory: 32,   // 32MB for active learning sessions
        kvStorage: 64,       // 64MB for knowledge graphs
        gitArchive: 256      // 256MB for versioned learning materials
      },
      capabilities: [
        'knowledge_graph',
        'spaced_repetition',
        'progress_tracking',
        'content_recommendation'
      ],
      modelPreferences: [
        { model: 'gpt-4', purpose: 'explanation', weight: 0.7 },
        { model: 'claude-3', purpose: 'reasoning', weight: 0.3 }
      ],
      uiComponents: [
        { type: 'progress_dashboard', priority: 'high' },
        { type: 'flashcard_system', priority: 'medium' },
        { type: 'concept_map', priority: 'low' }
      ],
      analytics: {
        track: ['engagement_time', 'concept_mastery', 'learning_velocity'],
        retentionDays: 90
      }
    });
    
    // DMLog: Data science and ML experimentation
    this.configs.set('dmlog', {
      id: 'dmlog',
      memoryAllocation: {
        sessionMemory: 48,   // 48MB for data processing
        kvStorage: 96,       // 96MB for experiment results
        gitArchive: 512      // 512MB for datasets and models
      },
      capabilities: [
        'data_visualization',
        'experiment_tracking',
        'model_comparison',
        'hyperparameter_search'
      ],
      modelPreferences: [
        { model: 'claude-3', purpose: 'analysis', weight: 0.6 },
        { model: 'gpt-4', purpose: 'code_generation', weight: 0.4 }
      ],
      uiComponents: [
        { type: 'data_explorer', priority: 'high' },
        { type: 'experiment_board', priority: 'high' },
        { type: 'model_playground', priority: 'medium' }
      ],
      analytics: {
        track: ['experiment_count', 'model_accuracy', 'compute_time'],
        retentionDays: 180
      }
    });
  }
  
  createThemeInstance(theme: DeploymentTheme): ThemeInstance {
    const config = this.configs.get(theme);
    if (!config) {
      throw new Error(`Unknown theme: ${theme}`);
    }
    
    return {
      config,
      runtime: this.createIsolatedRuntime(config),
      middleware: this.createThemeMiddleware(theme),
      constraints: this.calculateConstraints(config)
    };
  }
  
  private createIsolatedRuntime(config: ThemeConfig): WorkerRuntime {
    // Create isolated runtime with theme-specific limits
    return {
      memoryLimit: config.memoryAllocation.sessionMemory * 1024 * 1024,
      cpuLimit: 30000, // 30 seconds
      allowedAPIs: this.getThemeAPIs(config.capabilities),
      isolation: 'theme' // Ensures no cross-theme contamination
    };
  }
}
```

## Three-Layer Memory Architecture

```typescript
/**
 * Hierarchical memory