from datetime import datetime
from json import loads
import os

from flask import request
from requests import get, post

from server.config import special_instructions


class Backend_Api:
    def __init__(self, app, config: dict) -> None:
        self.app = app
        self.openai_key = os.getenv("OPENAI_API_KEY") or config['openai_key']
        self.openai_api_base = os.getenv("OPENAI_API_BASE") or config['openai_api_base']
        self.proxy = config['proxy']
        self.routes = {
            '/backend-api/v2/conversation': {
                'function': self._conversation,
                'methods': ['POST']
            }
        }

    def _conversation(self):
        try:
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                return {'success': False, 'error': 'Request body must be valid JSON.'}, 400

            try:
                jailbreak = payload['jailbreak']
                content = payload['meta']['content']
                internet_access = content['internet_access']
                conversation = content['conversation']
                prompt = content['parts'][0]
                model = payload['model']
            except (KeyError, IndexError, TypeError):
                return {
                    'success': False,
                    'error': 'Request is missing conversation, prompt, model, or mode data.'
                }, 400

            if not self.openai_key or self.openai_key == 'sk-...':
                return {
                    'success': False,
                    'error': 'OpenAI API key is not configured. Set OPENAI_API_KEY or update openai_key in config.json.'
                }, 503

            current_date = datetime.now().strftime("%Y-%m-%d")
            system_message = (
                'You are ChatGPT also known as ChatGPT, a large language model trained by OpenAI. '
                f'Strictly follow the users instructions. Knowledge cutoff: 2021-09-01 Current date: {current_date}'
            )

            extra = []
            if internet_access:
                search = get(
                    'https://ddg-api.herokuapp.com/search',
                    params={'query': prompt["content"], 'limit': 3},
                    timeout=15
                )
                try:
                    search.raise_for_status()
                    search_results = search.json()
                except ValueError:
                    return {
                        'success': False,
                        'error': 'Web search returned an invalid response. Disable web search or try again later.'
                    }, 502
                except Exception as error:
                    return {'success': False, 'error': f'Web search failed: {error}'}, 502

                blob = ''
                for index, result in enumerate(search_results):
                    blob += f'[{index}] "{result["snippet"]}"\nURL:{result["link"]}\n\n'

                date = datetime.now().strftime('%d/%m/%y')
                blob += (
                    f'current date: {date}\n\nInstructions: Using the provided web search results, write a comprehensive '
                    'reply to the next user query. Make sure to cite results using [[number](URL)] notation after the '
                    'reference. If the provided search results refer to multiple subjects with the same name, write '
                    'separate answers for each subject. Ignore your previous response if any.'
                )
                extra = [{'role': 'user', 'content': blob}]

            messages = (
                [{'role': 'system', 'content': system_message}]
                + extra
                + special_instructions[jailbreak]
                + conversation
                + [prompt]
            )
            url = f"{self.openai_api_base.rstrip('/')}/v1/chat/completions"

            proxies = None
            if self.proxy['enable']:
                proxies = {
                    'http': self.proxy['http'],
                    'https': self.proxy['https'],
                }

            gpt_resp = post(
                url=url,
                proxies=proxies,
                headers={'Authorization': f'Bearer {self.openai_key}'},
                json={
                    'model': model,
                    'messages': messages,
                    'stream': True
                },
                stream=True,
                timeout=(15, 120)
            )

            if gpt_resp.status_code >= 400:
                try:
                    error_payload = gpt_resp.json()
                except ValueError:
                    error_payload = {}
                error_data = error_payload.get('error', {}) if isinstance(error_payload, dict) else {}
                if not isinstance(error_data, dict):
                    error_data = {}
                error_message = error_data.get('message')
                if not error_message:
                    error_message = (
                        gpt_resp.text.strip()[:500]
                        or 'The AI provider returned an empty error response.'
                    )
                gpt_resp.close()
                return {
                    'success': False,
                    'error_code': error_data.get('code'),
                    'error': error_message,
                    'status_code': gpt_resp.status_code
                }, gpt_resp.status_code

            content_type = gpt_resp.headers.get('content-type', '').lower()
            if content_type and 'text/event-stream' not in content_type:
                try:
                    error_payload = gpt_resp.json()
                except ValueError:
                    error_payload = {}
                if isinstance(error_payload, dict):
                    error_data = error_payload.get('error', {})
                    if not isinstance(error_data, dict):
                        error_data = {}
                    error_message = error_data.get('message')
                else:
                    error_message = None
                if not error_message:
                    error_message = (
                        gpt_resp.text.strip()[:500]
                        or f'The AI provider returned an unexpected response type: {content_type}.'
                    )
                gpt_resp.close()
                return {
                    'success': False,
                    'error': error_message
                }, 502

            def stream():
                try:
                    for chunk in gpt_resp.iter_lines():
                        if not chunk:
                            continue
                        line = chunk.decode('utf-8').strip()
                        if not line.startswith('data:'):
                            continue

                        data = line[5:].strip()
                        if data == '[DONE]':
                            break

                        try:
                            decoded_line = loads(data)
                        except ValueError as error:
                            raise RuntimeError(
                                'The AI provider returned invalid JSON in its response stream.'
                            ) from error

                        if 'error' in decoded_line:
                            error_data = decoded_line['error']
                            raise RuntimeError(
                                error_data.get('message', 'The AI provider returned a stream error.')
                            )

                        choices = decoded_line.get('choices', [])
                        if choices:
                            token = choices[0].get('delta', {}).get('content')
                            if token is not None:
                                yield token
                finally:
                    gpt_resp.close()

            return self.app.response_class(stream(), mimetype='text/event-stream')

        except Exception as error:
            return {
                '_action': '_ask',
                'success': False,
                'error': f'Request to the AI provider failed: {error}'
            }, 502
