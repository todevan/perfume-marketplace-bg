<script lang="ts">
	let { data, form } = $props();
	let enrollment = $derived(form?.mode === 'enrollment');
</script>

<svelte:head>
	<title>Двуфакторна проверка · Marketplace beta</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="section">
	<div class="container mfa-card surface">
		<span class="eyebrow">Защитена staff зона</span>
		<h1>Потвърди втория фактор.</h1>
		{#if form?.message}<p role="status">{form.message}</p>{/if}

		{#if enrollment && form?.qrCode && form?.factorId}
			<img class="qr" src={form.qrCode} alt="QR код за authenticator приложение" />
			<details><summary>Ръчно въвеждане</summary><code>{form.secret}</code></details>
			<form method="POST" action="?/verifyEnrollment">
				<input type="hidden" name="next" value={form.next ?? data.next} />
				<input type="hidden" name="factorId" value={form.factorId} />
				<label for="enrollment-code">Шестцифрен код</label>
				<input id="enrollment-code" class="input" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
				<button class="button primary" type="submit">Активирай MFA</button>
			</form>
		{:else if data.factors.length > 0}
			<form method="POST" action="?/verify">
				<input type="hidden" name="next" value={data.next} />
				<label for="factor-id">Authenticator</label>
				<select id="factor-id" class="select" name="factorId">
					{#each data.factors as factor}<option value={factor.id}>{factor.friendlyName}</option>{/each}
				</select>
				<label for="mfa-code">Шестцифрен код</label>
				<input id="mfa-code" class="input" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
				<button class="button primary" type="submit">Продължи</button>
			</form>
		{:else}
			<p>Няма активен authenticator фактор за този staff профил.</p>
			<form method="POST" action="?/enroll"><input type="hidden" name="next" value={data.next} /><button class="button primary" type="submit">Настрой MFA</button></form>
		{/if}
	</div>
</section>

<style>
	.mfa-card { display: grid; gap: 16px; max-width: 620px; padding: clamp(28px, 6vw, 60px); }
	form { display: grid; gap: 12px; }
	.qr { width: min(240px, 100%); height: auto; background: white; }
	code { overflow-wrap: anywhere; }
</style>
