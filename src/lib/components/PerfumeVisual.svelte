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
</script>

<div class:compact class="visual" style={`--backdrop:${visual.backdrop}; --glass:${visual.glass}; --liquid:${visual.liquid}; --cap:${visual.cap}`}>
  <svg viewBox="0 0 240 260" role="img" aria-label={`Илюстрация на ${label}`}>
    <defs>
      <linearGradient id={`glass-${label.replaceAll(' ', '-')}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="white" stop-opacity=".62" />
        <stop offset=".35" stop-color={visual.glass} stop-opacity=".86" />
        <stop offset="1" stop-color={visual.glass} />
      </linearGradient>
      <clipPath id={`bottle-${label.replaceAll(' ', '-')}`}><path d={path} /></clipPath>
      <filter id={`shadow-${label.replaceAll(' ', '-')}`} x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="12" stdDeviation="9" flood-color="#2b1c16" flood-opacity=".23" />
      </filter>
    </defs>
    <ellipse cx="120" cy="221" rx="72" ry="12" fill="#2b1c16" opacity=".12" />
    <g filter={`url(#shadow-${label.replaceAll(' ', '-')})`}>
      <path d="M96 38 H144 V59 H96Z" fill={visual.cap} />
      <path d="M101 30 Q101 25 106 25 H134 Q139 25 139 30 V42 H101Z" fill={visual.cap} opacity=".82" />
      <path d={path} fill={`url(#glass-${label.replaceAll(' ', '-')})`} stroke="#fff" stroke-opacity=".5" stroke-width="2" />
      <rect x="40" y={liquidY} width="160" height="150" fill={visual.liquid} opacity=".55" clip-path={`url(#bottle-${label.replaceAll(' ', '-')})`} />
      <path d="M77 70 Q84 61 96 61" fill="none" stroke="white" stroke-opacity=".7" stroke-width="3" stroke-linecap="round" />
      <rect x="82" y="108" width="76" height="58" rx="2" fill="#f7f0e6" opacity=".91" />
      <path d="M96 124 H144 M101 134 H139 M108 146 H132" stroke="#4a3126" stroke-width="2" opacity=".68" />
      <circle cx="120" cy="118" r="4" fill="#4a3126" opacity=".75" />
    </g>
  </svg>
  <span class="scent-ring ring-one"></span><span class="scent-ring ring-two"></span>
</div>

<style>
  .visual {
    position: relative;
    display: grid;
    min-height: 280px;
    place-items: center;
    overflow: hidden;
    background:
      radial-gradient(circle at 55% 30%, rgb(255 255 255 / 72%), transparent 34%),
      var(--backdrop);
    isolation: isolate;
  }

  .visual::after {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(125deg, transparent 40%, rgb(255 255 255 / 22%) 40.4%, transparent 41%);
    content: '';
  }

  svg {
    width: min(72%, 240px);
    transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  :global(a:hover) .visual svg,
  .visual:hover svg {
    transform: translateY(-5px) rotate(-1deg) scale(1.03);
  }

  .scent-ring {
    position: absolute;
    z-index: -1;
    width: 210px;
    height: 210px;
    border: 1px solid rgb(74 49 38 / 14%);
    border-radius: 50%;
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
</style>
