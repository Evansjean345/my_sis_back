import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const UserController = () => import('#presentation/http/controllers/identity/user_controller')

export const adminUsersRoutes = () => {
  router
    .group(() => {
      // ---- utilisateurs
      router.get('/stats', [UserController, 'statsAll'])
      router.get('/', [UserController, 'indexAll'])
      router.post('/', [UserController, 'storeAll'])
      router.get('/:id', [UserController, 'showAll'])
      router.patch('/:id', [UserController, 'updateAll'])
      router.post('/:id/suspend', [UserController, 'suspendAll'])
      router.post('/:id/activate', [UserController, 'activateAll'])
      router.delete('/:id', [UserController, 'destroyAll'])
    })
    .prefix('/users')
    .where('id', router.matchers.uuid())
    .where('memberId', router.matchers.uuid())
}
