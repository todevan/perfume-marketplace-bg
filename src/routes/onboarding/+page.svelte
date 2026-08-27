<script lang="ts">
	let { data, form } = $props();
	let submittedUsername = $derived(form && 'username' in form ? form.username : null);
	let submittedCity = $derived(form && 'city' in form ? form.city : null);
	const documentLabels: Record<string, string> = {
		beta_terms: 'Условията за ползване',
		privacy_notice: 'Политиката за поверителност',
		age_18_confirmation: 'потвърждението за навършени 18 години',
		marketplace_rules: 'Правилата на marketplace beta'
	};
</script>

<svelte:head>
	<title>Завърши профила · Marketplace beta</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="section">
	<div class="container onboarding surface">
		<span class="eyebrow">Завършване на регистрацията</span>
		<h1>Завърши профила си.</h1>
		<p>Публично се вижда потребителското име. Имейлът остава скрит.</p>
		{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}

		<form method="POST">
			<input type="hidden" name="next" value={data.next} />
			<label for="onboarding-username">Потребителско име</label>
			<input id="onboarding-username" class="input" name="username" value={submittedUsername ?? data.profile?.username ?? ''} minlength="3" maxlength="40" autocomplete="username" required />
			<label for="onboarding-city">Град</label>
			<input id="onboarding-city" class="input" name="city" value={submittedCity ?? data.profile?.city ?? ''} maxlength="100" autocomplete="address-level2" />

			{#if data.documents.length > 0}
				<fieldset>
					<legend>Задължителни документи</legend>
					{#each data.documents as document}
						<label class="consent">
							<input type="checkbox" name={`consent_${document.documentCode}`} required />
							<span>Приемам {documentLabels[document.documentCode] ?? document.documentCode} (версия {document.currentVersion}).</span>
						</label>
					{/each}
				</fieldset>
			{/if}
			<button class="button primary" type="submit">Активирай достъпа</button>
		</form>
	</div>
</section>

<style>
	.onboarding { max-width: 720px; padding: clamp(28px, 6vw, 64px); }
	.onboarding > p { color: var(--ink-soft); }
	form { display: grid; gap: 11px; margin-top: 28px; }
	label span { color: var(--ink-soft); font-weight: 400; }
	fieldset { display: grid; gap: 12px; margin-block: 12px; padding: 18px; border: 1px solid var(--line); border-radius: 12px; }
	.consent { display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: start; }
	.consent input { width: 18px; height: 18px; accent-color: var(--action); }
	.form-error { color: var(--danger, #8b1e1e); }
</style>
