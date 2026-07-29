<aside class="demo-banner" aria-label="Статус на приложението">
	<div class="container">
		<strong>Локална демонстрация</strong>
		<span aria-hidden="true">·</span>
		<span>Примерните данни не се изпращат или запазват.</span>
	</div>
</aside>

<style>
	.demo-banner {
		position: relative;
		z-index: 40;
		border-bottom: 1px solid #a9bcae;
		color: var(--success);
		background: var(--success-soft);
		font-size: 0.75rem;
	}

	.demo-banner .container {
		display: flex;
		min-height: 36px;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding-block: 7px;
		text-align: center;
	}

	.demo-banner strong {
		font-weight: 700;
	}

	@media (max-width: 560px) {
		.demo-banner .container {
			align-items: flex-start;
			flex-direction: column;
			gap: 0;
			text-align: left;
		}

		.demo-banner .container > span[aria-hidden='true'] {
			display: none;
		}
	}
</style>
