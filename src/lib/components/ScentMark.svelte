<script lang="ts">
  export let size = 42;
  export let inverted = false;
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 48 48"
  fill="none"
  aria-hidden="true"
  class:inverted
>
  <path d="M18 12.5h12M20 8h8v4.5h-8z" stroke="currentColor" stroke-width="1.6" />
  <path
    d="M16.5 16.5c0-2.2 1.8-4 4-4h7c2.2 0 4 1.8 4 4v3.3c0 1.2.5 2.3 1.4 3.1l1.2 1.1c.9.8 1.4 2 1.4 3.2v8.3c0 2.5-2 4.5-4.5 4.5H17c-2.5 0-4.5-2-4.5-4.5v-8.3c0-1.2.5-2.4 1.4-3.2l1.2-1.1c.9-.8 1.4-1.9 1.4-3.1z"
    stroke="currentColor"
    stroke-width="1.6"
  />
  <path d="M17.5 28.5c4.4-3.6 8.8 3.6 13 0v6h-13z" fill="currentColor" opacity=".18" />
  <circle cx="24" cy="28" r="3.3" stroke="currentColor" stroke-width="1.2" />
</svg>
