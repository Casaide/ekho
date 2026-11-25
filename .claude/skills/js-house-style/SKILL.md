---
name: js-house-style
description: House style for writing, structuring, reviewing, or refactoring any JavaScript — for Bare, Node, or both. Use for essentially any JS authoring or review task: writing a module, refactoring, code review, judging structure, making something composable, weighing a dependency, or adding tests. Encodes how we build — small single-responsibility modules composed on primitives, do-more-with-less, no defensive programming — and the judgment behind it.
version: 1.0.0
---

# JS house style

How we write JavaScript — for Bare, for Node, for both. Small modules. One thing each. Do more with less. Compose tiny pieces through a few shared conventions so that many small modules behave like one coherent system.

The most important rule comes first because it governs all the others:

**Don't follow rules without thinking. Make the best code you can, always.**

Everything below is a default with a reason attached. Defaults exist so you don't re-derive them every time, and so a codebase reads consistently. But a default you can't justify in the moment is a default you should question. Important things are made well and thoughtfully — the judgment about _when a rule earns its place_ is the actual skill. The rest is scaffolding for that judgment.

If you internalize five things:

1. **One module, one responsibility — perfect at one thing, composed with the rest.** If you can't describe it in one sentence without "and", it's two modules. Build on the layer below rather than reimplementing it (compact-encoding → hyperschema → hrpc; hypercore → hyperbee → hyperdb → autobee). Build the smallest piece that validates the rest first.
2. **Make construction cheap; do real work lazily; tear down explicitly.** No async in constructors. Open on first use, close cleanly. `ready-resource` / `ready-guard` give you this when it fits — use them where lifecycle matters, skip them where it doesn't.
3. **Streams for flows, events for notifications, no defensive guards.** `streamx` for data that flows. Events for "something happened." Don't program defensively — let caller bugs crash; surface real operational failure on the resource. The README, tests, and semver are the contract, not runtime guard code.
4. **Write for Bare and Node at once.** `b4a` instead of the `Buffer` global; `compact-encoding` for wire and disk formats. These cost nothing on Node and make the same code run on Bare. That portability is the default because we target both.
5. **Every dependency is a liability you pay for forever.** Each must earn its place in one sentence. A 40-line module you understand beats a 4000-line one you don't. Reach for the small ecosystem primitives before inventing or importing.

---

## The method: work backwards from ambition, iterate like hell

Before structure comes direction. The way we approach a problem (mafintosh's framing, which the whole way of working is built on):

- Start from the **great ambition** — the real thing you want to exist.
- Plan _backwards_ into small, self-contained pieces. Sort them topologically.
- Build the **smallest piece that most efficiently validates the rest** first. Scope it down until the first iteration is a couple of days. Then execute immediately — never stall, never wait for a grand plan to be complete.
- Lineage example: "unstoppable P2P file sharing" → Hypercore → "address Merkle-tree nodes efficiently" → `flat-tree`, built day 0. Each layer is a small publishable module that stands on its own.

Two failure modes this guards against, both worth catching in review:

- **Working hard in the wrong direction.** Effort mimics progress — tasks closed, bugs fixed — while the direction is wrong. Run the complexity check continuously: _is this the right way, and is there a simpler way to execute the ambition?_ Sunk cost is real. Cut early.
- **Scope creep.** It kills projects. Small modules are the antidote — each is independently finishable, testable, replaceable.

On using AI to do this work (heed it, since this skill is often _for_ an AI): AI with human comprehension is powerful; without it, quickly destructive. **Don't generate a subsystem you can't evaluate.** If you don't know what _good_ looks like for the thing (the canonical cautionary tale: a BBR congestion-control implementation that looked fine and wasn't), generating it costs more than it saves. Build the comprehension first, or get it from someone who has it, then generate.

Practical upshot: bias to the smallest correct thing, make it composable, move on.

---

## Build on primitives — let each module be perfect at one thing

This is the heart of the style. A module should do **one thing perfectly** and expose it cleanly. The next capability up doesn't reimplement that thing, doesn't reach around it, doesn't fork it — it **composes** it. The ecosystem is a stack of layers where each one is a thin, sharp module sitting on the one below.

The two canonical lineages:

```
compact-encoding  →  hyperschema  →  hrpc
   (the wire)         (typed         (RPC over
                       structs on      typed messages
                       the wire)       on the wire)

hypercore  →  hyperbee  →  hyperdb  →  autobee
 (append-      (B-tree      (typed,      (multiwriter
  only log)     KV on the    indexed      hyperbee via
                log)         collections  autobase)
                             on the bee)
```

Read those left to right: each arrow is "built _on_, not instead of." `hyperschema` doesn't invent its own serialization — it generates `compact-encoding` codecs. `hrpc` doesn't invent a message format — it speaks `hyperschema`. `hyperbee` doesn't invent storage — it's a B-tree over a `hypercore`. `hyperdb` doesn't invent a tree — it's collections and indexes over a `hyperbee`. `autobee` doesn't invent consensus from scratch — it's a `hyperbee` made multiwriter through `autobase`.

What this means when you write code:

- **Find the lowest layer that already solves your sub-problem and build the thin next layer on it.** Before writing storage, ask which of hypercore/hyperbee/hyperdb already gives you 90% of it. You are almost never starting from zero — you're adding one sharp capability to an existing primitive.
- **Each layer is independently perfect and independently usable.** Someone who needs just the wire format uses `compact-encoding` and never sees `hrpc`. Don't bundle concerns upward — a lower layer must never depend on a higher one, and must be useful on its own.
- **Don't reach around a layer.** If you're on `hyperdb` and find yourself poking at the underlying `hypercore` directly to do something the bee/db layer should express, that's a smell: either the layer is missing a capability (add it _there_, in its own module) or you're at the wrong layer.
- **Don't collapse layers "for convenience."** A module that does encoding _and_ storage _and_ RPC is the thing this style exists to prevent. Three modules, each perfect, composed. The seams are the feature — they're where reuse, testing, and replacement happen.
- **Composition is by passing the lower thing in.** A higher module takes the primitive it builds on as a constructor argument (the `store`, the `core`, the `bee`), it doesn't construct it secretly or hard-wire it. That's what keeps layers swappable and testable.

When you reach for a new capability, the instinct is: _which primitive is this one honest step above, and what is the smallest module that adds exactly that step?_

---

## Module anatomy

A well-shaped module is a single default export, an options bag, cheap construction, and — where it has resources — a clean teardown.

```js
const b4a = require('b4a')

module.exports = class Thing {
  constructor(store, opts = {}) {
    this.store = store
    this.foo = opts.foo ?? defaultFoo
    this._internal = null // declare every field here, even if null
  }

  async open() {
    this._internal = await this.store.get()
  }

  async doWork(arg) {
    // ...
  }
}
```

The conventions, each with its reason:

- **Default export is the thing.** One per module. A second named export is usually a sign you have two modules. _Reason: composition is by `require('thing')`, and one-export modules slot together predictably._
- **`(required, opts = {})` constructor.** Positional for the one or two things the module fundamentally _is_ (the store, the key, the core); everything else in the options bag with `??` defaults. _Reason: the signature documents what's essential vs. configurable._
- **Declare all instance fields in the constructor**, even `null` ones. _Reason: a reader sees the whole shape in one place, and the engine keeps a stable hidden class._
- **No async work in the constructor.** Construction is synchronous and cheap; async setup happens in an `open`/`ready` step, lazily. _Reason: constructors can't await, and an object that's secretly half-built is a footgun._
- **Match the surrounding project on CommonJS vs ESM.** No house default — read the package and be consistent within it. Don't mix in one package without a reason.

### README shape

Ship the same structure on every module — OSS, private, or throwaway. Consistency is the point:

```
# module-name
One-line description.
## Installation   npm i module-name
## Usage          the smallest runnable real example
## API            constructor + each method
## License        match the project
```

Keep Usage runnable and minimal — it's the first thing anyone copies.

---

## Lifecycle: a pattern, used where it earns its place

When a thing owns resources — a file, a core, a socket, a watcher — it needs orderly setup and teardown. `ready-resource` and `ready-guard` give you that, and most of our stateful code uses them. But this is a **pattern, not a mandate**. A pure function or a stateless helper doesn't need a lifecycle; bolting one on is over-engineering. Use it where lifecycle genuinely matters; skip it where it doesn't. Same judgment applies to every primitive below — reach for it because it fits, not because it's on a list.

When it does fit, `ready-resource` gives you:

- `ready()` — idempotent; runs `_open()` exactly once, concurrent callers await the same promise. Safe to call on every method.
- `close()` — idempotent; runs `_close()` once. Safe before `ready()`, safe twice.
- `opened` / `closed` / `opening` / `closing` state, and a `'close'` event.

The rules when you use it:

- **Implement `_open`/`_close`; never call them directly.** `ready()`/`close()` are the public surface.
- **`_open` opens dependencies in order; `_close` reverses it.** Close the watcher before the core it watches.
- **Guard close-during-open.** Check `this.closing` at suspension points in `_open` so a teardown mid-setup doesn't leak a half-built resource.
- **Public async methods start with `await this.ready()`.** That's the laziness contract — construct then call, the first call opens.

If you're writing an `init()` method, stop — that's `ready()`, and you're reimplementing it.

---

## Streams, events, errors

### Flows → streamx

Use `streamx`, not Node core `stream`. _Reason: lighter, predictable backpressure, runs on Bare, and it's what the ecosystem speaks._ `Readable`/`Writable`/`Duplex`/`Transform` plus `pipeline`.

```js
const { Readable } = require('streamx')

class Query extends Readable {
  constructor(db, range) {
    super()
    this.db = db
    this.range = range
    this._it = null
  }

  _open(cb) {
    this._it = this.db.iterator(this.range)
    cb(null)
  }

  async _read(cb) {
    const { done, value } = await this._it.next()
    if (done) this.push(null)
    else this.push(value)
    cb(null)
  }

  _destroy(cb) {
    this._it?.close().then(() => cb(null), cb)
  }
}
```

streamx's stream hooks (`_open`/`_read`/`_write`/`_destroy`, callback-style) are not ReadyResource's promise-based `_open`/`_close` — don't conflate them. Prefer returning a stream over building a giant array when results are large or unbounded; `for await (const x of stream)` is the consumer idiom.

### Notifications → events

EventEmitter (or streamx's emitter) for "something happened": `'close'`, `'update'`, `'peer-add'`. Fire-and-forget signals, not data pipes, not request/response.

### Errors: don't program defensively

We do **not** program defensively. We don't litter methods with arg-type checks, null guards, or "did you call this in the right order" assertions. _Reason: defensive code is complexity you write, read, and pay for at runtime forever — to handle a case that is a caller bug, not a real condition._ The contract is the README and the tests; semver protects it. A dev who uses the API totally wrong gets a native crash, and that is the correct outcome — fail fast, fail loud, fix the call site.

- **Let misuse fail.** Pass a string where a buffer goes? It throws from deep in the stack. Fine. That's a bug in their code, surfaced immediately, not a state your module should anticipate or absorb.
- **Don't validate inputs you've documented.** The documented type _is_ the validation. Re-checking it in code is redundant with the README and the tests.
- **Operational failure is different — that travels with the resource.** A dropped peer, a replication error, a disk hiccup are real runtime conditions, not caller bugs → emit `'error'`, reject the in-flight promise, or expose state. Don't take the process down for a network blip.
- **`safety-catch`** rethrows real bugs while swallowing benign teardown rejections, so a genuine programmer error still crashes loudly rather than getting silently eaten:
  ```js
  const safetyCatch = require('safety-catch')
  somePromise().catch(safetyCatch)
  ```
- **Never swallow silently.** If you catch and ignore an _operational_ error, leave a comment on why it's safe.

The line to hold: **caller bug → let it crash. Runtime condition → handle it on the resource.** Don't blur the two by defending against the first.

---

## Concurrency: scope-lock

Async interleaving is the recurring tax. The answer is `scope-lock` — concurrency semantics around entering a scope — to serialize access to a shared resource. It's `lock()` / `unlock()`, not acquire-a-release-fn.

```js
const ScopeLock = require('scope-lock')

const l = new ScopeLock()

async function append(data) {
  await l.lock()
  try {
    await reallyAppend(data)
  } finally {
    l.unlock()
  }
}
```

`lock()` queues — callers run in order, one at a time. Always `unlock()` in `finally`; a lock you never release deadlocks the scope silently.

It also has a **debounced** mode, for when you don't need every queued entry to run — only the first and the last. Coalescing a burst of "something changed, re-sync" calls into one leading and one trailing run is the classic use:

```js
const d = new ScopeLock({ debounce: true })

async function resync() {
  if (await d.lock()) {
    // only the entries that actually get the scope return true
    try {
      await doResync()
    } finally {
      d.unlock()
    }
  }
}

await d.flush() // wait for all current work in the scope to drain
```

Use a plain lock when every call must run; use debounce when intermediate calls are redundant and only the latest state matters. Don't reach for either when the operation is already atomic, and don't build an elaborate queue when a scope lock suffices.

---

## Buffers and wire formats (Bare + Node)

### b4a everywhere

**Don't use the `Buffer` global.** _Reason: it may not exist on Bare. `b4a` is identical behavior, runs on both._ This is the default precisely because we target Bare and Node from the same source.

```js
const b4a = require('b4a')

b4a.from('hello') // not Buffer.from
b4a.alloc(32) // not Buffer.alloc
b4a.equals(a, b) // not a.equals(b)
b4a.toString(buf, 'hex') // not buf.toString('hex')
b4a.concat([a, b])
```

A single `Buffer.from` is a portability bug in code meant to run on Bare.

### compact-encoding for the wire

Wire and on-disk formats use `compact-encoding` — positional, length-prefixed, no field tags.

```js
const c = require('compact-encoding')

const message = {
  preencode(state, m) {
    c.uint.preencode(state, m.seq)
    c.string.preencode(state, m.name)
  },
  encode(state, m) {
    c.uint.encode(state, m.seq)
    c.string.encode(state, m.name)
  },
  decode(state) {
    return { seq: c.uint.decode(state), name: c.string.decode(state) }
  }
}
```

Carved-in-stone rule: **fields are positional — new fields append at the END; existing fields are never removed, reordered, or retyped.** Any data already on disk or replicated to a peer is frozen. Plan the format before shipping. For typed records, prefer `hyperschema`/`hyperdb` codegen over hand-rolling (see the hyperdb-hyperschema skill).

---

## Dependency discipline

Each dependency is maintained forever — its bugs, breaking changes, security surface, and weight on Bare become yours.

- **Prefer the small ecosystem primitive** first: `b4a`, `streamx`, `ready-resource`, `ready-guard`, `scope-lock`, `safety-catch`, `compact-encoding`, `hypercore-crypto`, `sodium-universal`. Small, audited, Bare-safe.
- **A small dependency you understand beats a large one you don't.** Need 40 lines of behavior from a 4000-line library? Write the 40 lines.
- **Vet for Bare-compatibility.** Anything touching the `Buffer` global, Node `stream`, raw `fs`, or unported native addons is suspect.
- **Justify every `package.json` entry in one sentence.** If you can't, it shouldn't be there.
- **Don't import to avoid an obvious function.** `isOdd` is the cautionary tale.

The governing question is the complexity check again: _is there a simpler way to execute the ambition?_ Often it's no dependency at all.

---

## Testing

Tests are the contract. Because we don't program defensively, the test suite plus the README plus semver are what keep the API safe to depend on — there's no guard code doing it at runtime. So tests carry real weight: **test the API the way a dev actually uses it.**

`brittle` is the standard — flat, assertion-driven, TAP-style. (Older repos use `tape`/`test`; match the repo.)

```js
const test = require('brittle')
const Thing = require('./')

test('basic append and read', async function (t) {
  const thing = new Thing(store)
  await thing.ready()
  t.teardown(() => thing.close())

  await thing.doWork('a')
  t.is(thing.length, 1)
  t.alike(await thing.get(0), expected)
})
```

What "test the API" means here:

- **Tests exercise the public surface as a consumer would call it** — construct, `ready()`, call the documented methods, assert the documented behavior. They're the executable version of the README's Usage section. If a method is documented, there's a test that uses it the documented way.
- **Test how the thing is _meant_ to be used, not how it's built.** Assert behavior through the public API (`t.is`, `t.alike`, `t.ok`), never reach into internals. A refactor that keeps the API stable must keep the tests green — that's the whole point.
- **You do not test misuse.** We don't program defensively, so there's nothing to assert about passing garbage in — that path is a native crash by design. Don't write tests that pin down the crash behavior of unsupported input; it isn't part of the contract and pinning it makes the contract accidentally wider.
- **Test the real failure paths that _are_ part of the contract** — close-during-open, the race you just fixed, the documented bounds that legitimately return nothing, operational errors surfacing on the resource. These are behaviors you promise; prove them.
- **`t.teardown()` for cleanup** — closes resources even when assertions fail. Use it for everything you open.
- **Flat tests, one `test()` per behavior.** The name states the assertion. No deep describe/it nesting.
- **Semver follows the tests.** A change that breaks an existing API test is a breaking change — major bump. Tests are how you know. Even small throwaway modules get CI, lint, and basic API tests; same checklist every time.

---

## Review checklist

Apply to any module, regardless of size or visibility. When reviewing, walk it and report violations tersely with the fix, in dependency order — don't rewrite wholesale unless asked. And remember the first rule: a flagged item is a prompt to think, not an automatic defect. If the code broke a default _for a good reason_, that's good code.

- [ ] One responsibility, describable without "and"; built on the layer below, not reimplementing or reaching around it.
- [ ] Composed by passing the lower primitive in (store/core/bee), not constructing it secretly; no layer depends upward.
- [ ] Single default export; `(required, opts = {})` constructor; all fields declared.
- [ ] Cheap construction, no async in constructor; lifecycle (ready/close) where resources warrant it, skipped where they don't.
- [ ] `b4a` for buffers, no `Buffer` global; runs on Bare and Node.
- [ ] `streamx` for flows; events for notifications; no defensive guards — caller bugs crash, operational failures surface on the resource; `safety-catch` where teardown rejections are expected.
- [ ] Shared-resource concurrency serialized (scope-lock) where interleaving would corrupt; not over-applied.
- [ ] Wire/disk format append-only and planned; codegen where it fits.
- [ ] Every dependency justified in one sentence; ecosystem primitives preferred.
- [ ] `brittle` tests that exercise the public API the way a consumer calls it, with `t.teardown`, covering the contracted failure paths; no tests pinning misuse behavior.
- [ ] API documented in the README and versioned with semver; breaking an API test means a major bump.
- [ ] README: install / usage (runnable) / API / license.
- [ ] CI + lint wired, even if tiny.
- [ ] Nothing generated that the author can't evaluate.

---

## Sibling skills

- Typed records, collections, indexes, `build.js` codegen → **hyperdb-hyperschema**.
- SvelteKit server owning a long-lived P2P stack on Bare → **svelte-bare-app**.

This skill governs the shape of the code underneath both.
