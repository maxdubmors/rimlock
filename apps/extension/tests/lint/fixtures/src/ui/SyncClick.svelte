<script lang="ts">
  let open = $state(false);

  function toggle(): void {
    open = !open;
  }

  async function save(): Promise<void> {
    await Promise.resolve();
  }
</script>

<!-- Allowed: each handler returns nothing. -->
<button onclick={toggle}>Toggle</button>
<button onclick={() => void save().catch(toggle)}>Save</button>
