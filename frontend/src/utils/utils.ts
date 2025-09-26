import { backendRequest } from "./request";

export const getMetadata = async () => {
  try {
    const res = await backendRequest("api/metadata", "GET", false);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("Failed to fetch metadata", err);
  }
  return null;
};

export const getSchema = async () => {
  const response = await backendRequest("api/schema", "GET", true);
  return {
    status: response.status,
    data: response.status === 200 ? await response.json() : null,
  };
};
