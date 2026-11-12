/**
 * useEmailSignatures — thin shim around localStorage for the two signature
 * surfaces an admin can edit (their personal sig + the club-wide footer).
 * Brief 103 replaces the storage layer with `GET / PUT /users/me/email-
 * signature` and `GET / PUT /clubs/:id/email-signature`; component code
 * only touches this composable, so the swap is confined to one file.
 */
import { ref, watch, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

function userKey(userId: number): string {
  return `torny.crm.email-signature.user.${userId}`
}
function clubKey(clubId: number): string {
  return `torny.crm.email-signature.club.${clubId}`
}

/** Stitches a draft HTML body + the personal signature + the club footer
 *  together with reasonable spacing. Whichever pieces are empty get
 *  dropped — admins who haven't saved a personal sig just get the club
 *  footer under their body, and vice versa. */
export function stitchSignature(opts: {
  bodyHtml: string
  personalHtml: string | null
  clubHtml: string | null
}): string {
  const parts: string[] = []
  const body = opts.bodyHtml?.trim() ?? ''
  if (body) parts.push(body)
  const personal = opts.personalHtml?.trim() ?? ''
  if (personal) parts.push(`<div class="torny-signature">${personal}</div>`)
  const club = opts.clubHtml?.trim() ?? ''
  if (club) parts.push(`<hr class="torny-signature-divider" /><div class="torny-club-footer">${club}</div>`)
  return parts.join('\n')
}

export function useEmailSignatures(): {
  personal: Ref<string>
  club: Ref<string>
  savePersonal: (html: string) => void
  saveClub: (html: string) => void
  isOwnerOrAdmin: Ref<boolean>
} {
  const auth = useAuthStore()
  const club = useClubStore()

  const personal = ref('')
  const clubSig = ref('')

  function load() {
    const uid = auth.user?.id
    if (uid != null) {
      try {
        personal.value = localStorage.getItem(userKey(uid)) ?? ''
      } catch { /* localStorage unavailable */ }
    }
    const cid = club.current?.id
    if (cid != null) {
      try {
        clubSig.value = localStorage.getItem(clubKey(cid)) ?? ''
      } catch { /* ignore */ }
    }
  }
  load()
  watch(() => auth.user?.id, load)
  watch(() => club.current?.id, load)

  function savePersonal(html: string): void {
    const uid = auth.user?.id
    if (uid == null) return
    personal.value = html
    try { localStorage.setItem(userKey(uid), html) } catch { /* ignore */ }
  }
  function saveClub(html: string): void {
    const cid = club.current?.id
    if (cid == null) return
    clubSig.value = html
    try { localStorage.setItem(clubKey(cid), html) } catch { /* ignore */ }
  }

  const isOwnerOrAdmin = ref(false)
  function recomputeRole() {
    const u = auth.user
    const activeClubId = club.current?.id
    const membership = u?.clubs.find((c) => c.id === activeClubId)
    isOwnerOrAdmin.value = membership?.role === 'owner' || membership?.role === 'admin'
  }
  recomputeRole()
  watch([() => auth.user?.id, () => club.current?.id, () => auth.user?.clubs], recomputeRole)

  return {
    personal,
    club: clubSig,
    savePersonal,
    saveClub,
    isOwnerOrAdmin,
  }
}
