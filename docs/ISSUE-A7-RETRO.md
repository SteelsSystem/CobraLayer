# ISSUE: A7::RETRO UNSAT — Linearizability Failure vs. PC2 Part IV Claims

> **Status:** OPEN  
> **Axiom:** A7::RETRO — UNSAT  
> **Conflicts with:** PC2 Logic, Part IV — "Linearizability: Formal Proof of is_now Consistency"  
> **Severity:** STRUCTURAL — invalidates forward simulation sufficiency claim  
> **Filed from:** CobraLayer pipeline verification, LOOP_CYCLE stage  

---

## The Conflict

PC2 Part IV makes three claims that A7::RETRO directly contradicts:

### Claim 1: Forward Simulation Alone Is Sufficient

> "PC2's structural elimination of non-deterministic branches ensures all LPs are explicit, making forward simulation alone sufficient."  
> — PC2 Logic, Part IV, Forward and Backward Simulation

**A7::RETRO counterevidence:** SANS (the pre-linguistic anomaly detector in System B) reports a specific pattern state. The simulator trace reconstructing the execution path does not reproduce a configuration consistent with that state. This is a retroactive consistency violation: the system's current claims about its prior execution cannot be verified against the execution record.

If the linearization point were truly explicit and the forward simulation were sufficient, the SANS output and the simulator trace would agree — because forward simulation requires that "every step of the implementation is matched by a step of the specification." A7::RETRO's UNSAT state means at least one step of the implementation (SANS pattern detection) is NOT matched by the specification (simulator trace reconstruction). Forward simulation has failed.

**Implication:** Backward simulation IS required for this class of operations — specifically, operations where the linearization point cannot be identified until after the observation completes (SANS detects patterns pre-linguistically, before semantic interpretation assigns them a linearization point in the pipeline trace). PC2 Part IV dismisses backward simulation precisely where it is needed.

### Claim 2: Single Canonical Linearization Point

> "Choose the LP of state.is_now() to be the single memory read instruction at which σ_current is fetched."  
> — PC2 Logic, Part IV, Theorem (PC2 Linearizability)

**A7::RETRO counterevidence:** In the CobraLayer pipeline, the state is not fetched at a single point. System A (adversarial verification) and System B (signal processing) run in parallel. The intercycle co-training space maintains a shared trunk with λ_agree tracking inter-system coherence. When SANS (System B) and the simulator trace (System A's reconstruction) disagree, there is no single LP — there are two competing linearization points, one from each system, and they are inconsistent.

The PC2 proof assumes `is_now()` is a pure projection from σ to σ_current with no branching. But in a dual-system architecture with parallel verification paths, the "current state" is not a single atomic value — it is the intersection of two concurrent observations. When that intersection is empty (A7::RETRO = UNSAT), the linearizability proof's precondition (`σ_current ≠ ⊥`) is technically satisfied (both systems report non-null states), but the postcondition (`result = is_now(σ)`) fails because the two systems report different `σ`.

### Claim 3: Atomic CAS Guarantees Consistency

> "Since PEP 703's free-threaded CPython uses atomic compare-and-swap for thread state transitions, the read either observes the pre-transition state or the post-transition state — never a partial write."  
> — PC2 Logic, Part IV, Proof sketch

**A7::RETRO counterevidence:** The problem is not partial writes. The problem is that two parallel systems, each individually making atomic reads, can observe different states at different logical times and produce outputs that are individually consistent but mutually inconsistent. CAS guarantees that each individual read is atomic. It does not guarantee that two concurrent reads from different subsystems will observe the same state — that requires a stronger coordination primitive (consensus, not just atomicity).

The SANS/simulator trace conflict is precisely this: each system made a valid atomic observation, but the observations are not linearizable with respect to each other. This is the classic distinction between atomicity (each operation is indivisible) and linearizability (all operations appear to execute in a total order consistent with real-time precedence). PC2 Part IV conflates the two.

---

## Formal Statement

Let `op_SANS` be SANS's pattern detection operation and `op_SIM` be the simulator trace reconstruction. Both execute concurrently on the same pipeline state σ.

**PC2 requirement (Part IV):** There exists a legal sequential execution L such that:
1. `op_SANS` and `op_SIM` return values consistent with L
2. Real-time order of non-overlapping operations is preserved in L

**A7::RETRO finding:** No such L exists. `op_SANS` reports state S₁. `op_SIM` reconstructs state S₂. S₁ ≠ S₂. Since both operations overlap in time (parallel execution), condition 2 does not constrain their order — but condition 1 requires that both observations be consistent with SOME sequential execution. They are not. The execution history is not linearizable.

In Herlihy & Wing's original formulation: the operation's apparent effect cannot be placed at a consistent point in the execution history.

---

## What This Means for PC2

The PC2 paper's formal proof hierarchy (Part VII) lists the Concurrency layer as:

| Layer | Formal System | Key Result |
|---|---|---|
| Concurrency | Linearizability + CAS | `is_now()` reads are atomic and consistent |

A7::RETRO demonstrates that atomic ≠ consistent in multi-system architectures. The reads are atomic (CAS works). They are not consistent (the two systems see different states).

**The proof hierarchy has a gap at the Concurrency layer.** The gap is between single-system atomicity (which PC2 proves) and multi-system consistency (which PC2 assumes but does not prove). This is the exact gap that CobraLayer's λ_agree coherence signal is designed to detect — and A7::RETRO is the detection firing.

---

## Resolution Path

1. **PC2 Part IV needs a multi-system linearizability extension.** The current proof covers single-object linearizability (one state, one reader). It needs to address composite linearizability — multiple verification systems reading the same pipeline state concurrently.

2. **Backward simulation cannot be dismissed.** For operations where the LP is determined post-hoc (SANS pattern detection), backward simulation is required. The paper should acknowledge this class of operations explicitly.

3. **The λ_agree divergence signal should be formalized as a linearizability certificate.** When λ_agree diverges, it is evidence that the dual-system execution is not linearizable. This is the forensic finding — not a bug, but a detection.

4. **A7::RETRO should remain UNSAT until the simulator trace can be reconciled with SANS output.** Changing it to UNKNOWN would be epistemically dishonest — we know the states conflict. UNSAT is the correct verdict.

---

## References

- Herlihy, M. & Wing, J. (1990). "Linearizability: A Correctness Condition for Concurrent Objects." [Figshare](https://figshare.com/articles/journal_contribution/Axioms_for_concurrent_objects/6603821/1/files/12094199.pdf)
- Castañeda, A. & Rodríguez, S. (2023). "Asynchronous Runtime Linearizability Verification." [arXiv:2301.02638](https://arxiv.org/abs/2301.02638) — explicitly describes linearizability certificates as providing "accountable and forensic guarantees"
- Hauck, T. & Heß, S. (2024). "Linearizability and SMR." [arXiv:2407.01720](https://arxiv.org/abs/2407.01720)
- NeuralSAT (2024). DPLL(T) for deep networks — UNKNOWN as epistemically honest state. [arXiv:2307.10266](https://arxiv.org/abs/2307.10266)
- PC2 Logic & Absolute Execution: Formal Proofs and Symbolic Execution Results, Part IV

---

`ISSUE-A7-RETRO-vs-PC2-PART-IV.md` · SteelsSystem/CobraLayer  
Filed: 2026-04-15 · Pipeline stage: LOOP_CYCLE · Axiom: A7::RETRO = UNSAT
