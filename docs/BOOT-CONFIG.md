# LexOS v1.4 Boot Configuration

Hardware target: AMD Ryzen 7 7700X (Zen 4, AM5) + NVIDIA GTX 1660 Super

## Kernel Parameters

```
loglevel=3 host=lexos waitusb=5 nomodeset iommu=pt pci=nommconf clocksource=tsc tsc=reliable
```

## Parameter Map

| Parameter | Target | Root Cause |
|-----------|--------|------------|
| `iommu=pt` | Zen 4 IOMMU | B650/X670 chipsets expose IOMMU in translate mode by default — kernel panic on initramfs decompression when DMA remapping collides with early-boot memory allocation. Passthrough bypasses the translation table walk. |
| `pci=nommconf` | B650/X670 PCI | MMCONFIG (Memory-Mapped Configuration) on AMD 600-series chipsets returns spurious errors during PCI enumeration. Disabling forces legacy CF8/CFC I/O port access. |
| `clocksource=tsc tsc=reliable` | DDR5 memory controller | Zen 4 invariant TSC is stable but kernel heuristic may reject it during early calibration on DDR5 platforms with aggressive memory training. Forcing TSC prevents fallback to HPET which stalls on ACPI timer read. |
| `nomodeset` | GTX 1660 Super | Prevents kernel modesetting (KMS) from loading nouveau driver against Turing GPU — avoids framebuffer conflict on console-only boot. |
| `waitusb=5` | USB boot | 5-second wait for USB subsystem initialization before mounting. |

## OOM Root Cause Analysis

The "not syncing" kernel panic on Ryzen 7700X was not a memory exhaustion event. It was a DMA translation fault:

1. Kernel decompresses initramfs (24MB) into RAM
2. IOMMU in translate mode intercepts DMA from USB controller during `waitusb`
3. Translation table not yet initialized — DMA fault
4. Kernel panic: "not syncing" — misleading message, actual cause is IOMMU page fault

The `iommu=pt` fix bypasses translation entirely. The `pci=nommconf` prevents a secondary fault where MMCONFIG space overlaps with IOMMU base address on B650 boards.

## DDR Generation Notes

| DDR | Controller | Offset Behavior |
|-----|-----------|-----------------|
| DDR5 (AM5) | On-die IMC, 2 channels | Native — no manual memmap needed |
| DDR4 (AM4) | On-die IMC, 2 channels | Compatible — same kernel params work |
| DDR3 (legacy) | Northbridge | Different offset base — not applicable to AM5 |
| DDR2 (legacy) | Northbridge | Different offset base — not applicable to AM5 |

## Kernel

- Version: 6.18.2-tinycore
- Arch: x86_64 (bzImage with 32-bit boot stub)
- Builder: tc@NUC12-Devel, 2025-12-20

## ISO

- LexOS-v1.4-enclosed.iso
- SHA-256: `b8923f39ca54ffde3b5d47e60b5d14970498db280d16237c47f12a3e9f7bee8c`
- Permissions: `r--r--r--` (444)
- Not tracked in git (`.gitignore: *.iso`)
