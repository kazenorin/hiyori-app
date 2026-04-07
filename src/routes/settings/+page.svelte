<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">Settings</h1>

		<!-- Model Configuration -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Model</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">API Provider</span>
				<select class="input mt-1">
					<option>OpenAI</option>
					<option>Anthropic</option>
					<option>Local</option>
				</select>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Model</span>
				<input class="input mt-1" type="text" placeholder="gpt-4" />
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">API Key</span>
				<input class="input mt-1" type="password" placeholder="sk-..." />
			</label>
		</section>

		<!-- Story Configuration -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Story Defaults</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Genre</span>
				<select class="input mt-1">
					<option>Fantasy</option>
					<option>Sci-Fi</option>
					<option>Mystery</option>
					<option>Horror</option>
					<option>Adventure</option>
				</select>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Narration Style</span>
				<select class="input mt-1">
					<option>Second Person</option>
					<option>First Person</option>
					<option>Third Person</option>
				</select>
			</label>
		</section>
	</div>
</div>
