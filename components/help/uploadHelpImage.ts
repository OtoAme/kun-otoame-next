import { kunFetchFormData } from '~/utils/kunFetch'

/** Uploads one image for a help post or answer body; returns its URL. */
export const uploadHelpImage = async (
  file: File
): Promise<{ url: string } | string> => {
  const formData = new FormData()
  formData.append('image', file)
  return kunFetchFormData<{ url: string } | string>('/help/image', formData)
}
