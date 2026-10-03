import { supabase } from '@/lib/supabase'

export default async function TestPage() {
  const { data, error } = await supabase
    .from('test_connection')
    .select('*')

  return (
    <main style={{ padding: '40px', fontFamily: 'Arial' }}>
      <h1>Supabase Connection Test</h1>

      {error ? (
        <p>Connection response: {error.message}</p>
      ) : (
        <p>Supabase connection is working!</p>
      )}

      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  )
}