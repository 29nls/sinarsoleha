import { useAuthStore } from '~/stores/auth'
import { can } from '~/utils/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()
  await auth.initialize()

  if (auth.status === 'unconfigured') {
    if (to.path !== '/login') return navigateTo('/login')
    return
  }

  const isLoginRoute = to.path === '/login'

  if (!auth.isAuthenticated) {
    if (isLoginRoute) return
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } })
  }

  if (isLoginRoute) return navigateTo('/dashboard')

  if (to.meta.capability && !can(auth.role, to.meta.capability)) {
    return abortNavigation(
      createError({
        statusCode: 403,
        statusMessage: 'Anda tidak memiliki izin untuk membuka halaman ini.',
        fatal: true,
      }),
    )
  }
})
