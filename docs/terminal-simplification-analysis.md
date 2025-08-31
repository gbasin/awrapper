# Terminal Session Simplification Analysis

## Current Architecture (from PRD)
- Runner spawns CLI agents with PTY for full terminal emulation
- Streams raw stdout/stderr to UI via WebSocket
- Supports real-time attach/detach for interactive sessions
- Preserves ANSI escape sequences for progress bars and formatting

## Simplification Options

### Option 1: Local Processing Only (Maximum Simplification)
**Architecture:**
- Process all output locally at the Runner
- Extract structured data (prompts, errors, artifacts)
- Send only processed/summarized data to UI
- No raw terminal streaming

**Pros:**
- Dramatically reduced bandwidth (90%+ reduction)
- Simpler UI - no terminal emulator needed
- Easier to implement search, filtering, analysis
- Better mobile performance

**Cons:**
- ❌ Loses interactive attach capability
- ❌ No real-time progress bars/ANSI visuals
- ❌ Can't handle unexpected prompts requiring user input
- ❌ Breaks core requirement from PRD: "attach to interactive CLI agents"

**Verdict:** Too limiting for stated requirements

---

### Option 2: Hybrid Mode (Recommended)
**Architecture:**
- Two operation modes per run:
  1. **Monitor Mode** (default): Local processing, structured events only
  2. **Interactive Mode** (on-demand): Full PTY streaming when user attaches

**Implementation:**
```typescript
interface RunMode {
  monitor: {
    // Default mode - process locally
    events: StructuredEvent[]  // prompts, errors, artifacts
    summary: string            // rolling summary of activity
    metrics: RunMetrics        // performance, progress
  }
  
  interactive: {
    // Activated when user clicks "Attach"
    ptyStream: ReadableStream  // raw terminal output
    inputChannel: WritableStream // keyboard input
  }
}
```

**Pros:**
- 80% bandwidth reduction for typical runs
- Preserves full interactivity when needed
- Better mobile experience (monitor mode by default)
- Can still handle human_input_request events
- Backward compatible with existing CLIs

**Cons:**
- More complex Runner implementation
- Mode switching adds UI complexity
- Still need terminal emulator in UI (but lazy-loaded)

---

### Option 3: Structured-First with PTY Fallback
**Architecture:**
- Require agents to emit structured JSON events
- PTY only for legacy/non-compliant CLIs
- Process everything else locally

**Pros:**
- Cleanest data model
- Best performance for compliant agents
- Progressive enhancement path

**Cons:**
- Requires agent modifications
- Two code paths to maintain
- May not work with third-party CLIs

---

## Recommendation: Hybrid Mode (Option 2)

### Why Hybrid is Best:
1. **Preserves core functionality** - Interactive attach is a key requirement
2. **Optimizes common case** - Most runs don't need interaction
3. **Progressive enhancement** - Can add more local processing over time
4. **Mobile-friendly** - Monitor mode works great on phones

### Implementation Plan:

#### Phase 1: Add Monitor Mode
- Runner extracts structured events locally
- Send condensed updates to UI (1-2 KB vs 10-100 KB)
- Keep existing PTY infrastructure

#### Phase 2: Mode Switching
- Add "Attach" button that switches to interactive mode
- Lazy-load terminal emulator component
- Stream raw PTY only when attached

#### Phase 3: Smart Detection
- Auto-switch to interactive if human_input_request detected
- Heuristics for when interaction likely needed

### Data Flow Examples:

**Monitor Mode (90% of runs):**
```
CLI -> PTY -> Runner[process] -> {events, summary} -> WebSocket -> UI
```

**Interactive Mode (10% of runs):**
```
CLI <-> PTY <-> Runner[passthrough] <-> WebSocket <-> Terminal UI
```

### Benefits for Your Use Cases:
- **Ensemble runs**: Monitor mode perfect for parallel agents
- **Mobile**: Monitor mode uses minimal bandwidth
- **Long runs**: Can check progress without full terminal
- **Debugging**: Switch to interactive when needed

## Next Steps:
1. Modify Runner to support dual modes
2. Add event extraction logic for common patterns
3. Update WebSocket protocol for mode switching
4. Create lightweight monitor UI component
5. Keep terminal emulator as lazy-loaded module