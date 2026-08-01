import { describe, expect, it, vi } from 'vitest';
import { ResendEmailAdapter } from '../src/resend-email-adapter.js';

const FROM = 'RUOStack <no-reply@ruostack.io>';
const MESSAGE = { to: 'ops@example.com', subject: 'Your RUOStack admin account', text: 'Temporary password: hunter2' };

function adapterWith(fetchImpl: typeof fetch) {
  return new ResendEmailAdapter({ apiKey: 're_test_key', from: FROM, fetchImpl });
}

const ok = () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });

describe('ResendEmailAdapter', () => {
  it('POSTs to the Resend API with the bearer key and the message payload', async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    await adapterWith(fetchImpl).send(MESSAGE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    expect(init.headers['Content-Type']).toBe('application/json');

    expect(JSON.parse(init.body)).toEqual({
      from: FROM,
      to: ['ops@example.com'],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  it('includes html only when the message carries it', async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    await adapterWith(fetchImpl).send({ ...MESSAGE, html: '<p>hi</p>' });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).html).toBe('<p>hi</p>');
  });

  it('throws with the status and response body on a non-2xx', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: 'domain is not verified' }), { status: 422, statusText: 'Unprocessable Entity' }),
    ) as unknown as typeof fetch;

    await expect(adapterWith(fetchImpl).send(MESSAGE)).rejects.toThrow(/422.*domain is not verified/s);
  });

  it('propagates a transport failure rather than swallowing it', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(adapterWith(fetchImpl).send(MESSAGE)).rejects.toThrow('ECONNREFUSED');
  });
});
