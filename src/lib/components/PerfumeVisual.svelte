<script lang="ts">
  import type { PerfumeVisualTheme } from '$lib/components/listing/presentation';

  export let visual: PerfumeVisualTheme;
  export let percent = 72;
  export let label = '';
  export let compact = false;

  const shapePath = {
    square: 'M62 70 Q62 56 76 56 H164 Q178 56 178 70 V192 Q178 208 162 208 H78 Q62 208 62 192Z',
    round: 'M72 82 Q72 54 100 54 H140 Q168 54 168 82 L181 178 Q184 208 154 208 H86 Q56 208 59 178Z',
    tall: 'M78 52 Q78 42 88 42 H152 Q162 42 162 52 V198 Q162 208 152 208 H88 Q78 208 78 198Z',
    wide: 'M48 88 Q48 70 66 70 H174 Q192 70 192 88 V190 Q192 208 174 208 H66 Q48 208 48 190Z'
  } as const;

  $: path = shapePath[visual.shape];
  $: liquidY = 208 - (Math.max(4, percent) / 100) * 130;
  $: safeLabel = label.replaceAll(' ', '-').replace(/[^a-zA-Z0-9_-]/g, '');
</script>

<div
  class:compact
  class="visual"
  style={`--backdrop:${visual.backdrop}; --glass:${visual.glass}; --liquid:${visual.liquid}; --cap:${visual.cap}`}
>
  <svg viewBox="0 0 240 260" role="img" aria-label={`Илюстрация на ${label}`}>
    <defs>
      <clipPath id={`bottle-${safeLabel}`}><path d={path} /></clipPath>
    </defs>
    <ellipse cx="120" cy="221" rx="68" ry="8" fill="var(--ink)" opacity=".12" />
    <g>
      <path d="M96 38 H144 V59 H96Z" fill={visual.cap} />
      <path d="M101 30 Q101 25 106 25 H134 Q139 25 139 30 V42 H101Z" fill={visual.cap} opacity=".82" />
      <path d={path} fill={visual.glass} stroke="var(--paper-strong)" stroke-opacity=".58" stroke-width="2" />
      <rect
        x="40"
        y={liquidY}
        width="160"
        height="150"
        fill={visual.liquid}
        opacity=".72"
        clip-path={`url(#bottle-${safeLabel})`}
      />
      <path d="M77 70 Q84 61 96 61" fill="none" stroke="var(--paper-strong)" stroke-opacity=".66" stroke-width="3" stroke-linecap="round" />
      <rect x="82" y="108" width="76" height="58" rx="2" fill="var(--paper-strong)" opacity=".94" />
      <path d="M96 124 H144 M101 134 H139 M108 146 H132" stroke="var(--ink)" stroke-width="2" opacity=".68" />
      <circle cx="120" cy="118" r="4" fill="var(--ink)" opacity=".75" />
    </g>
  </svg>
  <span class="scent-ring ring-one"></span>
  <span class="scent-ring ring-two"></span>
</div>

<style>
  .visual {
    position: relative;
    display: grid;
    min-height: 280px;
    place-items: center;
    overflow: hidden;
    background: var(--backdrop);
    isolation: isolate;
  }

  .visual::before {
    position: absolute;
    top: 12%;
    right: 8%;
    width: 32%;
    aspect-ratio: 1;
    border: 1px solid var(--paper-strong);
    content: '';
    opacity: 0.42;
    transform: rotate(14deg);
  }

  svg {
    width: min(72%, 240px);
    transition: transform 260ms ease;
  }

  :global(a:hover) .visual svg,
  .visual:hover svg {
    transform: translateY(-3px) scale(1.018);
  }

  .scent-ring {
    position: absolute;
    z-index: -1;
    width: 210px;
    height: 210px;
    border: 1px solid var(--ink);
    border-radius: 50%;
    opacity: 0.12;
    transform: rotateX(66deg) rotateZ(-10deg);
  }

  .ring-one {
    top: 28px;
    right: -75px;
  }

  .ring-two {
    bottom: -112px;
    left: -22px;
    width: 280px;
    height: 280px;
  }

  .compact {
    min-height: 220px;
  }

  .compact svg {
    width: min(70%, 190px);
  }

  @media (prefers-reduced-motion: reduce) {
    svg {
      transition: none;
    }
  }
</style>
