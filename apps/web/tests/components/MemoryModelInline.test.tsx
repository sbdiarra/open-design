// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryModelInline } from '../../src/components/MemoryModelInline';
import { I18nProvider } from '../../src/i18n';

function renderMemoryModelInline() {
  return render(
    <I18nProvider>
      <MemoryModelInline
        mode="daemon"
        apiProtocol="openai"
        chatApiKey=""
        chatBaseUrl=""
        chatApiVersion=""
        chatModel="gpt-5.4"
        cliAgentId="codex"
        cliModelOptions={[
          'gpt-5.4',
          'gpt-5.4-mini',
          'gpt-5.5',
          'o3',
          'o4-mini',
          'claude-sonnet-4-5',
          'claude-opus-4-1',
          'gemini-2.5-pro',
          'gemini-2.5-flash',
        ]}
      />
    </I18nProvider>,
  );
}

describe('MemoryModelInline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the searchable dropdown for memory models and filters options inside the popover', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/memory') {
        return new Response(
          JSON.stringify({ enabled: true, memories: [], extraction: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === '/api/memory/config') {
        return new Response(
          JSON.stringify({ enabled: true, extraction: JSON.parse(String(init?.body)).extraction }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMemoryModelInline();

    const combobox = await screen.findByRole('combobox', { name: 'Memory model' });
    expect(combobox.className).toContain('inline-switcher__select');

    fireEvent.click(combobox);
    const popover = await screen.findByTestId('memory-model-inline-popover');
    const search = within(popover).getByTestId('memory-model-inline-search') as HTMLInputElement;
    expect(search).toBeTruthy();

    fireEvent.change(search, { target: { value: 'gemini' } });

    await waitFor(() => {
      expect(within(popover).getByRole('option', { name: 'gemini-2.5-pro' })).toBeTruthy();
      expect(within(popover).queryByRole('option', { name: 'gpt-5.4-mini' })).toBeNull();
    });
  });
});
