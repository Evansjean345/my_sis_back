import router from '@adonisjs/core/services/router'
import { throttle } from '#start/limiter'
import { middleware } from '#start/kernel'
const AuthController = () => import('#presentation/http/controllers/identity/auth_controller')

// --------------------------------------------------------------- connexion
export const authRoutes = () => {
  router
    .group(() => {
      // --------------------------------------------------------------- connexion
      router.post('/login', [AuthController, 'login']).use(throttle.auth)
      // --------------------------------------------------------------- mot de passe oublié (OTP SMS)
      router
        .group(() => {
          router.post('/forgot', [AuthController, 'forgotPassword']).use(throttle.otpRequest)
          router.post('/verify', [AuthController, 'verifyResetCode']).use(throttle.otpVerify)
          router.post('/reset', [AuthController, 'resetPassword']).use(throttle.otpVerify)
        })
        .prefix('/password')
      // ---- session
      router
        .group(() => {
          router.get('/me', [AuthController, 'me'])
          router.post('/logout', [AuthController, 'logout'])
        })
        .where('id', router.matchers.uuid())
        .use(middleware.auth())
    })
    .prefix('/auth')
}
