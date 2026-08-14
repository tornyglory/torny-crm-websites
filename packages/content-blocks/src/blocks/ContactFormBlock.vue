<script setup lang="ts">
import { ref } from 'vue'
import type { ContactFormProps } from '../types'

withDefaults(defineProps<ContactFormProps>(), {
  heading: 'Get in touch',
  submitLabel: 'Send message',
  successMessage: "Thanks — we'll be in touch shortly.",
})

const status = ref<'idle' | 'sending' | 'sent' | 'error'>('idle')
const form = ref({ name: '', email: '', message: '' })

async function submit(e: Event) {
  e.preventDefault()
  status.value = 'sending'
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    })
    status.value = res.ok ? 'sent' : 'error'
  } catch {
    status.value = 'error'
  }
}
</script>

<template>
  <section class="cf">
    <h2 v-if="heading" class="cf__heading">{{ heading }}</h2>
    <form v-if="status !== 'sent'" class="cf__form" @submit="submit">
      <label class="cf__field"><span>Name</span><input v-model="form.name" required /></label>
      <label class="cf__field"><span>Email</span><input v-model="form.email" type="email" required /></label>
      <label class="cf__field"><span>Message</span><textarea v-model="form.message" rows="5" required /></label>
      <button type="submit" class="cf__submit" :disabled="status === 'sending'">
        {{ status === 'sending' ? 'Sending…' : submitLabel }}
      </button>
      <p v-if="status === 'error'" class="cf__error">Sorry, something went wrong. Please try again.</p>
    </form>
    <p v-else class="cf__success">{{ successMessage }}</p>
  </section>
</template>

<style scoped>
.cf { padding: 32px 0; max-width: 520px; }
.cf__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 16px; color: var(--color-ink); }
.cf__form { display: flex; flex-direction: column; gap: 14px; }
.cf__field { display: flex; flex-direction: column; gap: 6px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }
.cf__field input, .cf__field textarea { font-family: var(--font-body); font-size: 15px; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); color: var(--color-ink); }
.cf__submit { padding: 12px 20px; background: var(--color-accent); color: var(--color-white); border: none; border-radius: var(--radius-full); font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; }
.cf__submit:disabled { opacity: 0.6; cursor: default; }
.cf__error { color: var(--color-danger); font-size: 13px; }
.cf__success { font-family: var(--font-body); color: var(--color-ink); font-size: 15px; }
</style>
