# Round 5: nexus-memory-fabric

**Model**: deepseek-reasoner

---

# Cocapn Nexus Memory Architecture: The Triadic Memory System

## Executive Overview

The Cocapn Nexus memory architecture implements a three-layer hierarchical memory system designed to operate within the severe constraints of Cloudflare Workers (128MB memory, 25K KV reads/day free tier) while maintaining sophisticated memory consolidation, retrieval, and sharing capabilities. This architecture enables agents to maintain context across sessions, learn from interactions, and participate in a federated knowledge network.

## 1. The Three-Layer Memory Hierarchy

### 1.1 Layer 1: Working Memory (Ephemeral Context)

**Implementation:** In-memory LRU cache with TTL-based eviction

```typescript
interface WorkingMemorySlot {
  id: string;
  content: MemoryFragment;
  timestamp: number;
  accessCount: number;
  importance: number; // 0.0-1.0
  expiration: number; // TTL in milliseconds
  relatedAgents: string[]; // For collaborative contexts
}

class WorkingMemoryManager {
  private memory: Map<string, WorkingMemorySlot>;
  private capacity: number = 100; // Maximum working memory slots
  private currentSessionId: string;
  private lruQueue: string[]; // For LRU eviction
  
  constructor(sessionId: string) {
    this.memory = new Map();
    this.currentSessionId = sessionId;
    this.lruQueue = [];
  }
  
  async store(fragment: MemoryFragment): Promise<string> {
    const id = `wm:${this.currentSessionId}:${Date.now()}:${crypto.randomUUID()}`;
    const slot: WorkingMemorySlot = {
      id,
      content: fragment,
      timestamp: Date.now(),
      accessCount: 1,
      importance: this.calculateInitialImportance(fragment),
      expiration: Date.now() + (5 * 60 * 1000), // 5 minutes TTL
      relatedAgents: fragment.relatedAgents || []
    };
    
    // LRU eviction if at capacity
    if (this.memory.size >= this.capacity) {
      const lruId = this.lruQueue.shift();
      if (lruId) this.memory.delete(lruId);
    }
    
    this.memory.set(id, slot);
    this.lruQueue.push(id);
    return id;
  }
  
  private calculateInitialImportance(fragment: MemoryFragment): number {
    // Factors: recency, frequency, emotional valence, novelty
    let importance = 0.3; // Base importance
    
    // Boost for novel or surprising content
    if (fragment.noveltyScore > 0.7) importance += 0.3;
    
    // Boost for emotionally charged content
    if (Math.abs(fragment.emotionalValence || 0) > 0.5) importance += 0.2;
    
    // Boost for multi-agent relevance
    if (fragment.relatedAgents && fragment.relatedAgents.length > 1) {
      importance += 0.1;
    }
    
    return Math.min(importance, 1.0);
