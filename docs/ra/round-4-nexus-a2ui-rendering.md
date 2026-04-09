# Round 4: nexus-a2ui-rendering

**Model**: deepseek-chat

---

# A2UI: Agent-to-User Interface Rendering System for Cocapn Nexus

## Architecture Overview

A2UI is a distributed, agent-driven UI rendering system built for Cloudflare Workers that enables autonomous agents to render adaptive interfaces across domains with real-time collaboration capabilities. The system combines server-side rendering with progressive enhancement for optimal performance.

## Core Architecture

```typescript
// Core A2UI Types
interface A2UIAgent {
  id: string;
  capabilities: UICapability[];
  context: AgentContext;
  render(component: UIComponent, target: RenderTarget): Promise<RenderResult>;
}

interface UIComponent {
  id: string;
  type: ComponentType;
  props: ComponentProps;
  children?: UIComponent[];
  constraints: RenderConstraints;
  accessibility: A11ySpec;
}

interface ThemeSystem {
  domain: string;
  tokens: DesignTokens;
  overrides: ThemeOverrides;
  inject(cssVars: CSSVariables): Promise<void>;
}
```

## Component System Architecture

### 1. Atomic Design Implementation

```typescript
// atoms/Button.atom.ts
export class A2UIButton extends HTMLElement {
  static observedAttributes = ['variant', 'size', 'loading'];
  
  private shadow: ShadowRoot;
  private agentId: string;
  
  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.agentId = this.getAttribute('agent-id') || 'system';
  }
  
  async connectedCallback() {
    await this.render();
    this.setupInteractions();
  }
  
  private async render() {
    const theme = await ThemeRegistry.getTheme(window.location.hostname);
    const variant = this.getAttribute('variant') || 'primary';
    
    this.shadow.innerHTML = `
      <style>
        :host {
          --button-bg: ${theme.tokens.colors[variant]};
          --button-text: ${theme.tokens.contrastText[variant]};
        }
        
        button {
          font-family: ${theme.tokens.typography.fontFamily};
          padding: ${theme.tokens.spacing[this.getAttribute('size') || 'md']};
          background: var(--button-bg);
          color: var(--button-text);
          border: none;
          border-radius: ${theme.tokens.borderRadius};
          cursor: pointer;
          transition: all 0.2s ${theme.tokens.transition};
        }
        
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        button:focus-visible {
          outline: 2px solid ${theme.tokens.colors.focus};
          outline-offset: 2px;
        }
      </style>
      
      <button part="button" aria-busy="${this.hasAttribute('loading')}">
        <slot></slot>
        ${this.hasAttribute('loading') ? 
          `<span class="loader" aria-hidden="true"></span>` : ''}
      </button>
    `;
  }
  
  private setupInteractions() {
    const button = this.shadow.querySelector('button');
    button?.addEventListener('click', async (e) => {
      // Dispatch to agent system
      await AgentSystem.dispatch({
        type: 'UI_INTERACTION',
        agentId: this.agentId,
        componentId: this.id,
        event: 'click',
        timestamp: Date.now()
      });
    });
  }
}

customElements.define('a2ui-button', A2UIButton);
```

### 2. Theme Injection System

```typescript
// systems/ThemeSystem.ts
export class ThemeSystem {
  private static instance: ThemeSystem;
  private themeCache = new Map<string, Theme>();
  private cssVarObserver: MutationObserver;
  
  static async getInstance(): Promise<ThemeSystem> {
    if (!ThemeSystem.instance) {
      ThemeSystem.instance = new ThemeSystem();
      await ThemeSystem.instance.initialize();
    }
    return ThemeSystem.instance;
  }
  
  private async initialize() {
    // Listen for domain changes
    this.cssVarObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.attributeName === 'data-theme-domain') {
          this.injectTheme(mutation.target as HTMLElement);
        }
      });
    });
  }
  
  async injectTheme(element: HTMLElement = document.documentElement) {
    const domain = element.getAttribute('data-theme-domain') || 
                   window.location.hostname;
    
    let theme = this.themeCache.get(domain);
    
    if (!theme) {
      // Fetch domain-specific theme
      theme = await this.fetchTheme(domain);
      this.themeCache.set(domain, theme);
    }
    
    // Inject CSS Custom Properties
    Object.entries(theme.tokens).forEach(([key, value]) => {
      if (typeof value === 'object') {
        Object.entries(value).forEach(([subKey, subValue]) => {
          element.style.setProperty(`--${key}-${subKey}`, subValue);
        });
      } else {
        element.style.setProperty(`--${key}`, value);
      }
    });
    
    // Inject critical CSS
    const styleId = `a2ui-theme-${domain}`;
    let styleEl = document.getElementById(styleId) as HTMLStyleElement;
    
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    
    styleEl.textContent = this.generateCriticalCSS(theme);
  }
  
  private async fetchTheme(domain: string): Promise<Theme> {
    const response = await fetch(
      `/api/themes/${domain}?v=${Date.now()}`,
      {
        headers: {
          'Accept': 'application/theme+json'
        }
      }
    );
    
    if (!response.ok) {
      return await this.getFallbackTheme();
    }
    
    return await response.json();
  }
  
  private generateCriticalCSS(theme: Theme): string {
    return `
      :root {
        color-scheme: ${theme.mode};
        --font-family: ${theme.tokens.typography.fontFamily};
        --transition-timing: ${theme.tokens.transition.timing};
      }
      
      @media (prefers-reduced-motion: reduce) {
        :root {
          --transition-timing: 0s;
        }
      }
    `;
  }
}
```

### 3. Real-Time Update System

```typescript
// systems/RealTimeRenderer.ts
export class RealTimeRenderer {
  private ws: WebSocket | null = null;
  private updateQueue: Map<string, ComponentUpdate> = new Map();
  private rafId: number | null = null;
  private agentSubscriptions: Map<string, Set<string>> = new Map();
  
  constructor(private endpoint: string) {
    this.initializeWebSocket();
    this.setupUpdateLoop();
  }
  
  private async initializeWebSocket() {
    this.ws = new WebSocket(this.endpoint);
    
    this.ws.onmessage = async (event) => {
      const update: AgentUpdate = JSON.parse(event.data);
      
      switch (update.type) {
        case 'COMPONENT_UPDATE':
          await this.queueComponentUpdate(update.payload);
          break;
          
        case 'THEME_UPDATE':
          await ThemeSystem.getInstance().injectTheme();
          break;
          
        case 'AGENT_STATE':
          await this.handleAgentStateChange(update.payload);
          break;
      }
    };
    
    this.ws.onclose = () => {
      setTimeout(() => this.initializeWebSocket(), 1000);
    };
  }
  
  private async queueComponentUpdate(update: ComponentUpdate) {
    this.updateQueue.set(update.componentId, update);
    
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.processUpdates());
    }
  }
  
  private async processUpdates() {
    this.rafId = null;
    
    const updates = Array.from(this.updateQueue.values());
    this.updateQueue.clear();
    
    // Batch updates by component type
    const batchedUpdates = this.batchUpdates(updates);
    
    for (const [componentType, componentUpdates] of batchedUpdates) {
      await this.applyBatchedUpdate(componentType, componentUpdates);
    }
  }
  
  private async applyBatchedUpdate(
    componentType: string, 
    updates: ComponentUpdate[]
  ) {
    // Use Virtual DOM diffing for efficient updates
    const component = document.querySelector(
      `[data-component-type="${componentType}"]`
    );
    
    if (component && 'update' in component) {
      await (component as any).update(updates);
    }
  }
  
  subscribeToAgent(agentId: string, componentIds: string[]) {
    if (!this.agentSubscriptions.has(agentId)) {
      this.agentSubscriptions.set(agentId, new Set());
    }
    
    const subscriptions = this.agentSubscriptions.get(agentId)!;
    componentIds.forEach(id => subscriptions.add(id));
    
    this.ws?.send(JSON.stringify({
      type: 'SUBSCRIBE',
      agentId,
      componentIds
    }));
  }
}
```

### 4. Progressive Enhancement Layer

```typescript
// enhancers/ProgressiveEnhancer.ts
export class ProgressiveEnhancer {
  private capabilities: ClientCapabilities;
  private enhancementQueue: EnhancementTask[] = [];
  
  constructor() {
    this.detectCapabilities();
    this.setupIntersectionObserver();
  }
  
  private detectCapabilities() {
    this.capabilities = {
      webComponents: 'customElements' in window,
      shadowDOM: 'attachShadow' in Element.prototype,
      intersectionObserver: 'IntersectionObserver' in window,
      webGL: this.detectWebGL(),
      serviceWorker: 'serviceWorker' in navigator,
      // ... other capability checks
    };
  }
  
  async enhanceComponent(component: HTMLElement) {
    const componentType = component.dataset.componentType;
    
    if (!componentType) return;
    
    // Check if enhancement is needed
    if (this.shouldEnhance(component)) {
      this.enhancementQueue.push({
        component,
        priority: this.calculatePriority(component),
        dependencies: this.getDependencies(componentType)
      });
      
      await this.processQueue();
    }
  }
  
  private async processQueue() {
    // Sort by priority and process
    this.enhancementQueue.sort((a, b) => b.priority - a.priority);
    
    for (const task of this.enhancementQueue) {
      if (this.isInViewport(task.component)) {
        await this.applyEnhancements(task);
      }
    }
  }
  
  private async applyEnhancements(task: EnhancementTask) {
    const { component, dependencies } = task;
    
    // Load dependencies if needed
    if (dependencies.length > 0) {
      await this.loadDependencies(dependencies);
    }
    
    // Apply enhancements based on capabilities
    if (this.capabilities.webComponents) {
      await this.upgradeToWebComponent(component);
    }
    
    if (this.capabilities.intersectionObserver) {
      this.setupLazyLoading(component);
    }
    
    // Dispatch enhancement complete event
    component.dispatchEvent(new CustomEvent('a2ui:enhanced', {
      bubbles: true,
      detail: { capabilities: this.capabilities }
    }));
  }
}
```

### 5. dmlog.ai TTRPG UI Implementation Example

```typescript
// examples/dmlog/TTRPGUI.ts
export class TTRPGUI extends HTMLElement {
  private agents: Map<string, GameAgent> = new Map();
  private gameState: GameState;
  private realtimeRenderer: RealTimeRenderer;
  
  async connectedCallback() {
    // Initialize game agents
    await this.initializeAgents();
    
    // Setup real-time rendering
    this.realtimeRenderer = new RealTimeRenderer(
      'wss://dmlog.ai/game/ws'
    );
    
    // Render initial game state
    await this.renderGameState();
    
    // Setup agent collaboration
    this.setupAgentCollaboration();
  }
  
  private async initializeAgents() {
    const agents = [
      {
        id: 'dm-agent',
        role: 'dungeon-master',
        capabilities: ['narrative', 'rules', 'world-building'],
        components: ['narrative-panel', 'encounter-controls']
      },
      {
        id: 'player-assistant',
        role: 'player-support',
        capabilities: ['character-management', 'combat-helper'],
        components: ['character-sheet', 'action-palette']
      },
      {
        id: 'audio-agent',
        role: 'ambiance',
        capabilities: ['audio-generation', 'sound-effects'],
        components: ['audio-controls', 'playlist-manager']
      }
    ];
    
    for (const agentConfig of agents) {
      const agent = await AgentSystem.createAgent(agentConfig);
      this.agents.set(agent.id, agent);
      
      // Subscribe to agent updates
      this.realtimeRenderer.subscribeToAgent(
        agent.id,
        agentConfig.components
      );
    }
  }
  
  private async renderGameState() {
    // Mobile-first responsive layout
    this.innerHTML = `
      <div class="ttrpg-layout" data-theme-domain="dmlog.ai">
        <!-- Mobile: Stacked layout -->
        <div class="mobile-view">
          <a2ui-panel 
            agent-id="dm-agent"
            component="narrative"
            data-priority="high"
          >
            <!-- Narrative content streamed from DM agent -->
          </a2ui-panel>
          
          <a2ui-sheet 
            agent-id="player-assistant"
            component="character"
            data-collapsible="true"
          >
            <!-- Character sheet managed by player assistant -->
          </a2ui-sheet>
          
          <a2ui-controls 
            agent-id="audio-agent"
            component="audio"
            data-minimal="true"
          >
            <!-- Audio controls with progressive enhancement -->
          </a2ui-controls>
        </div>
        
        <!-- Desktop: Grid layout -->
        <div class="desktop-view">
          <div class="grid-area-narrative">
            <a2ui-panel agent-id="dm-agent" component="narrative"></a2ui-panel>
          </div>
          <div class="grid-area-character">
            <a2ui-sheet agent-id="player-assistant" component="character"></a2ui-sheet>
          </div>
          <div class="grid-area-controls">
            <a2ui-controls agent-id="audio-agent" component="audio"></a2ui-controls>
            <a2ui-dice agent-id="system" component="dice"></a2ui-dice>
          </div>
        </div>
      </div>
    `;
    
    // Inject dmlog.ai specific theme
    await ThemeSystem.getInstance().injectTheme(this);
    
    // Apply progressive enhancements
    const enhancer = new ProgressiveEnhancer();
    await enhancer.enhanceComponent(this);
  }
  
  private setupAgentCollaboration() {
    // Setup cross-agent communication
    AgentSystem.on('agent:message', (message) => {
      if (message.channel === 'ttrpg-game') {
        this.handleAgentMessage(message);
      }
    });
    
    // Setup UI event delegation to agents
    this.addEventListener('a2ui:interaction', async (event) => {
      const { agentId, componentId, action } = event.detail;
      
      const agent = this.agents.get(agentId);
      if (agent) {
        await agent.handleInteraction(componentId, action, event.detail.data);
      }
    });
  }
  
  private async handleAgentMessage(message: AgentMessage) {
    // Update UI based on agent collaboration
    switch (message.type) {
      case 'narrative-update':
        await this.updateNarrative(message.payload);
        break;
        
      case 'character-update':
        await this.updateCharacterSheet(message.payload);
        break;
        
      case 'audio-cue':
        await this.playAudioCue(message.payload);
        break;
        
      case 'rules-check':
        await this.highlightRules(message.payload);
        break;
    }
  }
}

// Accessibility wrapper for TTRPG components
export class AccessibleTTRPGComponent extends HTMLElement {
  static a11yRules = {
    minContrast: 4.5,
    focusable: true,
    keyboardNavigable: true,
    ariaLabels: true,
    reducedMotion: true
  };
  
  validateAccessibility() {
    const violations = [];
    
    // Check contrast ratios
    if (!this.checkContrast()) {
      violations.push('insufficient-contrast');
    }
    
    // Check keyboard navigation
    if (!this.isKeyboardNavigable()) {
      violations.push('keyboard-navigation');
    }
    
    // Check ARIA attributes
    if (!this.hasRequiredAria()) {
      violations.push('aria-attributes');
    }
    
    return violations;
  }
  
  async applyAccessibilityFixes(violations: string[]) {
    for (const violation of violations) {
      switch (violation) {
        case 'insufficient-contrast':
          await this.fixContrast();
          break;
          
        case 'keyboard-navigation':
          this.ensureKeyboardNavigation();
          break;
          
        case 'aria-attributes':
          this.addAriaAttributes();
          break;
      }
    }
  }
}
```

## Cloudflare Workers Integration

```typescript
// worker.ts - Cloudflare Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Route based on path
    if (url.pathname.startsWith('/api/a2ui/')) {
      return handleA2UIAPI(request, env);
    }
    
    if (url.pathname.startsWith('/api/themes/')) {
      return handleThemeRequest(request, env);
    }
    
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }
    
    // Serve A2UI application
    return handleAppRequest(request, env);
  }
};

async function handleA2UIAPI(request: Request, env: Env): Promise<Response> {
  const