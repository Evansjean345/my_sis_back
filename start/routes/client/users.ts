import router from '@adonisjs/core/services/router'
const UserController = () => import('#presentation/http/controllers/identity/user_controller')

export const userRoutes = () => {
  router
    .group(() => {
      router.post('/me/password', [UserController, 'changePassword'])
      router.get('/stats', [UserController, 'stats'])
      router.get('/', [UserController, 'index'])
      router.post('/', [UserController, 'store'])
      router.get('/:id', [UserController, 'show'])
      router.patch('/:id', [UserController, 'update'])
      router.post('/:id/suspend', [UserController, 'suspend'])
      router.post('/:id/activate', [UserController, 'activate'])
      router.delete('/:id', [UserController, 'destroy'])
    })
    .prefix('/users')
    .where('id', router.matchers.uuid())
}

export const userRoles = () => {
  router.get('/roles', [UserController, 'roles']).where('id', router.matchers.uuid())
}
