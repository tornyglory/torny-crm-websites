import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Club } from '@torny/api-client'

export const useClubStore = defineStore('club', () => {
  const current = ref<Club | null>(
    (() => {
      const raw = localStorage.getItem('torny.currentClub')
      return raw ? (JSON.parse(raw) as Club) : null
    })(),
  )
  const memberships = ref<Club[]>([])

  function setCurrent(club: Club) {
    current.value = club
    localStorage.setItem('torny.currentClub', JSON.stringify(club))
  }

  function clear() {
    current.value = null
    memberships.value = []
    localStorage.removeItem('torny.currentClub')
  }

  return { current, memberships, setCurrent, clear }
})
