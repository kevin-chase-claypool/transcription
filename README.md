# Tablet Transcriber

A small Next.js app for uploading an audio or video file from a tablet, sending it to OpenAI's server-side speech-to-text API, and editing the returned transcript in the browser.

The app uses the official `openai` npm package and the `gpt-4o-transcribe` model. The OpenAI API key is read only on the server from `OPENAI_API_KEY`; it is never included in frontend code.

## Features

- Mobile-friendly upload form for MP3, WAV, M4A, MP4, MPEG, WEBM, and OGG files.
- Optional language field, defaulting to `en`.
- Optional prompt/hints field for names, jargon, places, or vocabulary.
- Optional math formatting pass that converts clear spoken equations into LaTeX-flavored Markdown.
- Editable transcript textarea.
- Copy transcript button.
- Download transcript as `transcript.txt`.
- Download transcript as a complete `.tex` document.
- Open the generated `.tex` document directly in Overleaf.
- API usage display for the returned audio duration or token totals.
- Server-side file validation with a 25 MB upload limit.

## Run Locally

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Add your OpenAI API key to `.env.local`:

```bash
OPENAI_API_KEY=sk-your_key_here
OPENAI_FORMAT_MODEL=gpt-4.1-mini
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Next.js, usually `http://localhost:3000`.

## Deploy with GitHub and Vercel

1. Create a new GitHub repository.
2. Push this project to that repository.
3. In Vercel, import the GitHub repository as a new project.
4. Add `OPENAI_API_KEY` as a Vercel environment variable.
5. Optionally add `OPENAI_FORMAT_MODEL` if you want to override the default `gpt-4.1-mini` math-formatting model.
6. Deploy the project.

Do not commit `.env`, `.env.local`, or any real API key to GitHub.

## Notes

OpenAI file uploads for this transcription route are limited to 25 MB, so this app rejects larger files before calling the API. Low-bitrate MP3s such as 48 kbps can work, but transcription accuracy may be lower if the audio is noisy, distorted, or hard to hear.

The "Format math as LaTeX" option makes a second OpenAI API call after transcription. That second call can improve math lecture notes, but it adds token usage and cost. The app shows formatting token usage separately when OpenAI returns it.

The "Open in Overleaf" button posts the generated LaTeX document to Overleaf's official `https://www.overleaf.com/docs` import endpoint. Overleaf handles project creation and PDF compilation after the new tab opens.
