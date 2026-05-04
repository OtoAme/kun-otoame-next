import { KUN_PATCH_DISABLE_REGISTER_KEY } from '~/config/redis'
import { delKv, getKv, setKv } from '~/lib/redis'

export const getDisableRegisterStatus = async () => {
  const isDisableKunPatchRegister = await getKv(KUN_PATCH_DISABLE_REGISTER_KEY)
  return {
    disableRegister: !!isDisableKunPatchRegister
  }
}

export const updateDisableRegisterStatus = async (disableRegister: boolean) => {
  if (disableRegister) {
    await setKv(KUN_PATCH_DISABLE_REGISTER_KEY, 'true')
  } else {
    await delKv(KUN_PATCH_DISABLE_REGISTER_KEY)
  }

  return {}
}
