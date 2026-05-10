import { useUser } from '../lib/api.js';

export default function Home() {
  const { data, isLoading, isError } = useUser();
  if (isLoading) return <div className="p-8">Loading...</div>;
  if (isError || !data) return <div className="p-8 text-red-600">Error loading user</div>;
  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Hello {data.name}</h1>
      <p className="text-gray-600">{data.email}</p>
      <p className="text-sm text-gray-400 mt-4">User ID: {data.id}</p>
      {data.avatarUrl && (
        <img src={data.avatarUrl} alt="avatar" className="mt-4 w-16 h-16 rounded-full" />
      )}
      {/* Banner — exercises the asset-proxy middleware (src rewritten to /__assets/proxy at build time in 1.F; manually proxied here for 1.E) */}
      <img
        src="/__assets/proxy?u=https%3A%2F%2Fexample.com%2Fbanner.png"
        alt="banner"
        className="mt-4 w-full"
      />
    </main>
  );
}
