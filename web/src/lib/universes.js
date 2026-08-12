// S6 Universes: curated sci-fi settings mapped onto real stars. Star
// mappings and route stops reference stars by name/designation ("Sun",
// a proper name, or a Bayer designation like "Tau Cet") — never a raw
// catalog row index, since indices aren't guaranteed stable across a
// tier1.bin rebuild but names/designations are. Resolved here against the
// already-loaded catalog (cat.nameByIndex / cat.desigByIndex). Per this
// app's own working rule ("omit or flag any mapping that can't be
// sourced, never guess one in") an unresolvable name is flagged, not
// silently dropped — callers decide how to surface that.
import { SUN_IDX } from "./catalog.js";

function resolveName(cat, name) {
  if (name === "Sun") return SUN_IDX;
  for (const [idx, v] of cat.nameByIndex.entries()) {
    if (v.name === name) return idx;
  }
  if (cat.desigByIndex) {
    for (const [idx, desig] of cat.desigByIndex.entries()) {
      if (desig === name) return idx;
    }
  }
  return null; // unresolved — caller must flag, not hide
}

export function resolveUniverses(cat, data) {
  return data.universes.map((u) => ({
    ...u,
    stars: u.stars.map((s) => {
      const idx = resolveName(cat, s.realName);
      return { ...s, idx, resolved: idx !== null };
    }),
    routes: u.routes.map((r) => {
      const stopIdx = r.stops.map((name) => resolveName(cat, name));
      return { ...r, stopIdx, resolved: stopIdx.every((i) => i !== null) };
    }),
  }));
}
