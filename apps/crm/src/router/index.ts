import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { requireOwner } from './guards'

const CrmShell = () => import('@/layouts/CrmShell.vue')
const AuthShell = () => import('@/layouts/AuthShell.vue')
const Placeholder = () => import('@/views/Placeholder.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AuthShell,
    children: [
      { path: '', name: 'sign-in', component: () => import('@/views/auth/SignInView.vue') },
      { path: 'claim', name: 'claim-club', component: () => import('@/views/auth/ClaimClubView.vue') },
      { path: 'forbidden', name: 'forbidden', component: () => import('@/views/auth/ForbiddenView.vue') },
    ],
  },
  {
    path: '/crm',
    component: CrmShell,
    beforeEnter: requireOwner,
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/dashboard/DashboardView.vue') },
      { path: 'members', name: 'members', component: () => import('@/views/members/MembersView.vue') },
      { path: 'members/:id', name: 'member-detail', component: Placeholder, props: { title: 'Member detail' } },
      { path: 'applications', name: 'applications', component: () => import('@/views/applications/ApplicationsView.vue') },
      { path: 'enquiries', name: 'enquiries', component: Placeholder, props: { title: 'Enquiries' } },
      { path: 'events', name: 'events', component: () => import('@/views/events/EventsView.vue') },
      { path: 'teams', name: 'teams', component: Placeholder, props: { title: 'Team selections' } },
      { path: 'teams/:id', name: 'team-editor', component: Placeholder, props: { title: 'Team selection editor' } },
      { path: 'honour-board', name: 'honour-board', component: () => import('@/views/honour-board/HonourBoardView.vue') },
      { path: 'achievements', name: 'achievements', component: Placeholder, props: { title: 'Achievements' } },
      { path: 'website', name: 'website', component: Placeholder, props: { title: 'Website editor' } },
      { path: 'communications', name: 'communications', component: Placeholder, props: { title: 'Communications' } },
      { path: 'settings', name: 'settings', component: Placeholder, props: { title: 'Settings' } },
      { path: 'site-settings', name: 'site-settings', component: Placeholder, props: { title: 'Site settings' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
