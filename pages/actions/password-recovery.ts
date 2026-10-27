export async function GET() { return Response.json({ available: false }); }
export async function POST() { return Response.json({ error: 'Solicite à administração do projeto a redefinição da sua senha.' }, { status: 400 }); }
