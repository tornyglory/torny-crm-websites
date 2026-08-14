// Injects the current club's brand color as a CSS custom property.
export function useTheme() {
  const club = useClub()

  useHead({
    style: computed(() => {
      const primary = club.value?.brandPrimary
      if (!primary) return []
      return [{ innerHTML: `:root { --color-accent: ${primary}; }` }]
    }),
  })
}
