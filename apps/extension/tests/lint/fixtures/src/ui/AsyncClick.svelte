<script lang="ts">
  async function save(): Promise<void> {
    await Promise.resolve();
  }
</script>

<!-- Violations: the promise save() returns is dropped, so a rejection goes unhandled. -->
<button onclick={save}>Save</button>
<button onclick={() => save()}>Save</button>
<button
  onclick={async () => {
    await save();
  }}>Save</button
>
