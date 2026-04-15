# PC2 Logic — Hardware Concurrency Extension

## Part IV-B: IOMMU Passthrough as Physical Linearization Point

### The Consistency Problem Across Layers

The "C" in ACID is a guarantee offered by the data store: once committed, all replicas are identical. Parallel reads yield the same result. This guarantee comes at great cost and complexity at scale. Vendors toy with the vernacular. Jepsen verifies where these guarantees break down.

PC2 Logic Part IV establishes that `state.is_now()` is linearizable under PEP 703's atomic compare-and-swap (CAS) for thread state transitions — this is strong consistency at the language runtime level. The linearization point (LP) is the single memory read instruction at which σ_current is fetched. No read observes a partial write.

But consistency does not stop at the application layer. Below the runtime, below the OS, the hardware bus is a distributed system. DMA controllers, IOMMU translation units, PCI configuration spaces, and clock sources are independent agents performing concurrent reads and writes against shared physical memory. The ACID guarantee must hold at every layer or it holds at none.

This section extends the concurrency model from software atomicity to hardware DMA concurrency, using the LexOS v1.4 boot failure on AMD Ryzen 7 7700X (Zen 4, AM5, DDR5) as the empirical case.

### The Hardware Concurrency Fault

The kernel panic ("not syncing") on Ryzen 7700X was a DMA translation fault — a hardware-level violation of the same linearizability invariant PC2 enforces in software.

#### Fault Sequence

```
t₀: Kernel decompresses initramfs (24MB) into physical RAM
t₁: USB controller issues DMA read (waitusb=5)
t₂: IOMMU (translate mode) intercepts DMA → walks translation table
t₃: Translation table NOT YET INITIALIZED at t₂
t₄: IOMMU page fault → kernel panic: "not syncing"
```

#### Root Cause in PC2 Terms

The IOMMU in translate mode operates as a speculative intermediary — it promises to translate a DMA address but the translation table is in an indeterminate state. This is the hardware equivalent of the legacy speculative function:

```
def iommu_translate(dma_addr):
    if table.maybe_ready:        # branch A — speculative
        return table.lookup(dma_addr)
    else:
        return FAULT              # branch B
```

The `table.maybe_ready` predicate is the "maybe" state PC2 eliminates. At early boot, the IOMMU translation table is neither fully initialized nor fully absent — it exists in a partial-write state that violates the atomicity guarantee:

```
∀t₁, t₂ ∈ Threads: read_t₁(σ) ∥ write_t₂(σ) ⇒ atomic(result_t₁)
```

The USB controller (t₁) reads DMA addresses concurrently with the kernel (t₂) writing the IOMMU translation table. The read observes a partial write. The linearization point does not exist.

### The Fix: iommu=pt as Hardware is_now()

`iommu=pt` (passthrough mode) eliminates the translation intermediary entirely. DMA addresses pass through without table lookup:

```
def iommu_passthrough(dma_addr):
    return dma_addr              # single deterministic projection
```

This is structurally identical to the PC2 absolute function:

```
def evaluate_reality(state):
    return state.is_now()        # single deterministic projection
```

The symbolic execution result collapses from O(2ⁿ) to O(1):

| Mode | Path Conditions | LP Exists? |
|------|----------------|------------|
| Translate (speculative) | π_A: table_ready ∧ entry_valid, π_B: ¬table_ready, π_C: table_ready ∧ ¬entry_valid | No — table state indeterminate at t₂ |
| Passthrough (absolute) | π_PT: dma_addr ≠ ⊥ | Yes — identity function, LP = read instruction |

### PCI MMCONFIG as Secondary Speculative Layer

The B650/X670 chipset exposes PCI configuration space via Memory-Mapped Configuration (MMCONFIG). On Zen 4 platforms, the MMCONFIG base address can overlap with the IOMMU base address region.

`pci=nommconf` forces legacy CF8/CFC I/O port access — a deterministic, non-overlapping channel. This eliminates the second speculative branch:

```
def pci_access(device):
    if mmconfig.region_valid:      # speculative — may overlap IOMMU
        return mmconfig.read(device)
    else:
        return ioport.read(device) # deterministic fallback

# PC2 fix:
def pci_access_absolute(device):
    return ioport.read(device)     # single path, no overlap
```

### Clock Source as Temporal Linearization

`clocksource=tsc tsc=reliable` forces the invariant Time Stamp Counter as the sole time reference. On Zen 4 with DDR5, the kernel heuristic may reject TSC during early calibration and fall back to HPET, which stalls on ACPI timer reads — introducing timing non-determinism.

Forcing TSC ensures temporal reads are linearizable: every time measurement observes a monotonically increasing counter with no speculative fallback path.

### The Cocycle Obstruction

In algebraic topology, a cocycle is a function that measures the failure of a local property to extend globally. A 1-cocycle on a cover {U_i} assigns to each overlap U_i ∩ U_j a transition function g_ij such that on triple overlaps:

```
g_ij · g_jk · g_ki = 1    (cocycle condition)
```

When this condition fails, the local data cannot be glued into a global object. The obstruction lives in a cohomology class — it is not a bug in any single patch, but a structural incompatibility between patches.

The IOMMU boot fault is a cocycle obstruction across hardware consistency domains:

```
U_kernel  = {physical RAM, page tables, initramfs}
U_usb     = {USB controller, DMA engine, device buffers}
U_iommu   = {translation tables, page walk unit, fault handler}
```

The transition functions:

```
g_kernel→iommu : physical_addr → translated_addr    (IOMMU mapping)
g_iommu→usb    : translated_addr → dma_target        (DMA routing)
g_usb→kernel   : dma_target → physical_addr           (completion)
```

The cocycle condition requires:

```
g_kernel→iommu · g_iommu→usb · g_usb→kernel = identity
```

At early boot, g_kernel→iommu is undefined — the translation table is in a partial-write state. The cocycle condition fails. The local consistency of each domain (kernel has valid RAM, USB has valid DMA engine, IOMMU has valid hardware) does not extend to global consistency. The obstruction class is non-trivial.

`iommu=pt` collapses the cover. Passthrough mode sets g_kernel→iommu = identity, which means:

```
identity · g_iommu→usb · g_usb→kernel = g_usb→kernel
```

The triple overlap reduces to a single transition. The cocycle condition is trivially satisfied. The obstruction class vanishes. Global consistency is restored — not by fixing the IOMMU translation table, but by removing the IOMMU from the consistency domain entirely.

This is the same move PC2 makes at the software level: eliminate the speculative intermediary so the cocycle condition cannot fail.

### ACID at Every Layer

| Property | Database | PEP 703 Runtime | Hardware Bus |
|----------|----------|-----------------|-------------|
| Atomicity | Transaction commits fully or not at all | CAS succeeds or retries — no partial state | DMA transfer completes or faults — no partial read |
| Consistency | All replicas identical after commit | All threads observe same σ_current | All bus agents observe same physical memory state |
| Isolation | Concurrent transactions don't interfere | Free-threaded reads don't observe partial writes | DMA and CPU don't corrupt each other's regions |
| Durability | Committed data survives failure | State persists across GC cycles | Written memory persists across clock domains |

The IOMMU fault violated Consistency and Isolation simultaneously: the USB controller (reader) observed a partial write (IOMMU table) from the kernel (writer). In database terms, this is a dirty read — the most severe consistency violation. In Jepsen terms, this would be classified as a linearizability violation under concurrent access.

`iommu=pt` does not add consistency — it removes the layer where consistency breaks. Application-level consistency (the boot sequence) is achieved by averting the cost and complexity of hardware-level strong consistency (IOMMU translation). The devil is in the details, and the detail is: the translation table does not exist at t₂.

### Synthesis: Hardware-Software Concurrency Stack

| Layer | Formal System | PC2 Violation | PC2 Fix |
|-------|---------------|---------------|---------|
| Software threads | PEP 703 CAS | Partial write observed by concurrent read | Atomic compare-and-swap |
| DMA translation | IOMMU page tables | Translation table in indeterminate state | `iommu=pt` — passthrough (identity function) |
| PCI enumeration | MMCONFIG regions | Address space overlap with IOMMU | `pci=nommconf` — legacy I/O (non-overlapping) |
| Clock calibration | TSC vs HPET | Fallback timer introduces jitter | `tsc=reliable` — single monotonic source |
| GPU framebuffer | KMS / nouveau | Driver loads speculative mode | `nomodeset` — no kernel modesetting |

Each fix follows the same PC2 pattern: eliminate the speculative intermediary, collapse the cocycle cover, ensure the linearization point exists. The obstruction class at every layer is resolved not by adding complexity but by removing the domain where consistency fails.

### Formal Statement

For a boot sequence B on hardware H with concurrent DMA controller D:

```
[σ_boot ≠ ⊥] B(H, D) [σ_running = is_now(H)]
```

is a total correctness triple iff:
1. No DMA translation table is in a partial-write state during B (iommu=pt)
2. No PCI configuration region overlaps DMA regions during B (pci=nommconf)
3. The clock source is monotonic and non-speculative during B (tsc=reliable)
4. No GPU driver loads speculative mode during B (nomodeset)

The boot either reaches `σ_running` deterministically or does not start — there is no "maybe booting" state.

Equivalently, the cocycle obstruction vanishes:

```
H¹(Cover_boot, GL(consistency)) = 0
```

under the passthrough trivialization. The global section (a running kernel) exists iff all local sections (RAM, DMA, PCI, clock) glue consistently. The boot parameters ensure they do.

### Hardware Target

- CPU: AMD Ryzen 7 7700X (Zen 4, 8C/16T, AM5)
- GPU: NVIDIA GeForce GTX 1660 Super (Turing, 6GB)
- RAM: DDR5 (AM5 native)
- Chipset: B650 / X670
- Kernel: 6.18.2-tinycore (TinyCore 17.0)
