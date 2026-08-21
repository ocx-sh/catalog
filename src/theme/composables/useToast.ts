import { ref } from 'vue'

// Module-level singleton — one toast surface for the whole site
// (CopyToast.vue in Layout renders it; any component may call toast()).
const message = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  function toast(text: string) {
    message.value = text
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      message.value = null
    }, 2000)
  }

  return { message, toast }
}
