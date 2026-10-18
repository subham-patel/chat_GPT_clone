const query = (obj) =>
  Object.keys(obj)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]))
    .join("&");
const markdown = window.markdownit();
const message_box = document.getElementById(`messages`);
const message_input = document.getElementById(`message-input`);
const box_conversations = document.getElementById(`conversation-list`);
const stop_generating = document.querySelector(`.stop_generating`);
const send_button = document.querySelector(`#send-button`);
let prompt_lock = false;

hljs.addPlugin(new CopyButtonPlugin());

function resizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
}

const format = (text) => {
  return escape_html(text).replace(/(?:\r\n|\r|\n)/g, "<br>");
};

const escape_html = (text) => {
  const element = document.createElement("div");
  element.textContent = text;
  return element.innerHTML;
};

message_input.addEventListener("blur", () => {
  window.scrollTo(0, 0);
});

message_input.addEventListener("focus", () => {
  document.documentElement.scrollTop = document.documentElement.scrollHeight;
});

const delete_conversations = async () => {
  if (!window.confirm("Delete all saved conversations? This cannot be undone.")) return;
  Object.keys(localStorage)
    .filter((key) => key.startsWith("conversation:"))
    .forEach((key) => localStorage.removeItem(key));
  await new_conversation();
};

const handle_ask = async () => {
  message_input.style.height = `35px`;
  message_input.focus();

  window.scrollTo(0, 0);
  let message = message_input.value;

  if (message.length > 0) {
    message_input.value = ``;
    await ask_gpt(message);
  }
};

const remove_cancel_button = async () => {
  stop_generating.classList.add(`stop_generating-hiding`);

  setTimeout(() => {
    stop_generating.classList.remove(`stop_generating-hiding`);
    stop_generating.classList.add(`stop_generating-hidden`);
  }, 300);
};

const ask_gpt = async (message) => {
  let text = ``;
  try {
    message_input.value = ``;
    message_input.innerHTML = ``;
    message_input.innerText = ``;

    add_conversation(window.conversation_id, message.substr(0, 20));
    window.scrollTo(0, 0);
    window.controller = new AbortController();

    const jailbreak = document.getElementById("jailbreak");
    const model = document.getElementById("model");
    prompt_lock = true;
    window.token = message_id();

    stop_generating.classList.remove(`stop_generating-hidden`);

    message_box.innerHTML += `
            <div class="message">
                <div class="user">
                    ${user_image}
                    <i class="fa-regular fa-phone-arrow-up-right"></i>
                </div>
                <div class="content" id="user_${window.token}">
                    ${format(message)}
                </div>
            </div>
        `;

    /* .replace(/(?:\r\n|\r|\n)/g, '<br>') */

    message_box.scrollTop = message_box.scrollHeight;
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
    window.scrollTo(0, 0);

    message_box.innerHTML += `
            <div class="message">
                <div class="user">
                    ${gpt_image} <i class="fa-regular fa-phone-arrow-down-left"></i>
                </div>
                <div class="content" id="gpt_${window.token}">
                    <div id="cursor"></div>
                </div>
            </div>
        `;

    message_box.scrollTop = message_box.scrollHeight;
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 1000));
    window.scrollTo(0, 0);

    const response = await fetch(`/backend-api/v2/conversation`, {
      method: `POST`,
      signal: window.controller.signal,
      headers: {
        "content-type": `application/json`,
        accept: `text/event-stream`,
      },
      body: JSON.stringify({
        conversation_id: window.conversation_id,
        action: `_ask`,
        model: model.options[model.selectedIndex].value,
        jailbreak: jailbreak.options[jailbreak.selectedIndex].value,
        meta: {
          id: window.token,
          content: {
            conversation: await get_conversation(window.conversation_id),
            internet_access: document.getElementById("switch").checked,
            content_type: "text",
            parts: [
              {
                content: message,
                role: "user",
              },
            ],
          },
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      let errorMessage = responseText;
      try {
        const errorResponse = JSON.parse(responseText);
        errorMessage = errorResponse.error || errorResponse.message || responseText;
      } catch (parseError) {
        if (!(parseError instanceof SyntaxError)) throw parseError;
      }
      throw new Error(errorMessage || `Request failed with status ${response.status}.`);
    }

    if (!response.body) {
      throw new Error("The server returned an empty response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }

      let chunk = decoder.decode(value, { stream: true });

      if (
        chunk.includes(
          `<form id="challenge-form" action="/backend-api/v2/conversation?`
        )
      ) {
        chunk = `cloudflare token expired, please refresh the page.`;
      }

      text += chunk;

      // const objects         = chunk.match(/({.+?})/g);

      // try { if (JSON.parse(objects[0]).success === false) throw new Error(JSON.parse(objects[0]).error) } catch (e) {}

      // objects.forEach((object) => {
      //     console.log(object)
      //     try { text += h2a(JSON.parse(object).content) } catch(t) { console.log(t); throw new Error(t)}
      // });

      document.getElementById(`gpt_${window.token}`).innerHTML =
        markdown.render(text);
      document.querySelectorAll(`code`).forEach((el) => {
        hljs.highlightElement(el);
      });

      window.scrollTo(0, 0);
      message_box.scrollTo({ top: message_box.scrollHeight, behavior: "auto" });
    }

    // if text contains :
    if (
      text.includes(
        `instead. Maintaining this website and API costs a lot of money`
      )
    ) {
      document.getElementById(`gpt_${window.token}`).innerHTML =
        "An error occured, please reload / refresh cache and try again.";
    }

    add_message(window.conversation_id, "user", message);
    add_message(window.conversation_id, "assistant", text);

    message_box.scrollTop = message_box.scrollHeight;
    await remove_cancel_button();
    prompt_lock = false;

    await load_conversations(20, 0);
    window.scrollTo(0, 0);
  } catch (e) {
    add_message(window.conversation_id, "user", message);

    message_box.scrollTop = message_box.scrollHeight;
    await remove_cancel_button();
    prompt_lock = false;

    await load_conversations(20, 0);

    console.log(e);

    let cursorDiv = document.getElementById(`cursor`);
    if (cursorDiv) cursorDiv.parentNode.removeChild(cursorDiv);

    const responseContainer = document.getElementById(`gpt_${window.token}`);
    if (e.name !== `AbortError`) {
      const error_message = e.message || "The request failed. Please try again.";
      if (responseContainer) responseContainer.textContent = error_message;
      add_message(window.conversation_id, "assistant", error_message);
    } else {
      if (responseContainer) responseContainer.textContent += ` [aborted]`;
      add_message(window.conversation_id, "assistant", text + ` [aborted]`);
    }

    window.scrollTo(0, 0);
  }
};

const clear_conversations = async () => {
  box_conversations.innerHTML = "";
};

const clear_conversation = async () => {
  let messages = message_box.getElementsByTagName(`div`);

  while (messages.length > 0) {
    message_box.removeChild(messages[0]);
  }
};

const show_option = async (conversation_id) => {
  const conv = document.getElementById(`conv-${conversation_id}`);
  const yes = document.getElementById(`yes-${conversation_id}`);
  const not = document.getElementById(`not-${conversation_id}`);

  conv.style.display = "none";
  yes.style.display = "block";
  not.style.display = "block"; 
}

const hide_option = async (conversation_id) => {
  const conv = document.getElementById(`conv-${conversation_id}`);
  const yes = document.getElementById(`yes-${conversation_id}`);
  const not = document.getElementById(`not-${conversation_id}`);

  conv.style.display = "block";
  yes.style.display = "none";
  not.style.display = "none"; 
}

const delete_conversation = async (conversation_id) => {
  localStorage.removeItem(`conversation:${conversation_id}`);

  const conversation = document.getElementById(`convo-${conversation_id}`);
  if (conversation) conversation.remove();

  if (window.conversation_id == conversation_id) {
    await new_conversation();
  }

  await load_conversations(20, 0, true);
};

const set_conversation = async (conversation_id) => {
  history.pushState({}, null, `/chat/${conversation_id}`);
  window.conversation_id = conversation_id;

  await clear_conversation();
  await load_conversation(conversation_id);
  await load_conversations(20, 0, true);
  toggle_sidebar(false);
};

const new_conversation = async () => {
  history.pushState({}, null, `/chat/`);
  window.conversation_id = uuid();

  await clear_conversation();
  await load_conversations(20, 0, true);
  toggle_sidebar(false);
};

const load_conversation = async (conversation_id) => {
  const storedConversation = localStorage.getItem(`conversation:${conversation_id}`);
  if (!storedConversation) return;
  const conversation = JSON.parse(storedConversation);

  for (const item of conversation.items) {
    message_box.innerHTML += `
            <div class="message">
                <div class="user">
                    ${item.role == "assistant" ? gpt_image : user_image}
                    ${
                      item.role == "assistant"
                        ? `<i class="fa-regular fa-phone-arrow-down-left"></i>`
                        : `<i class="fa-regular fa-phone-arrow-up-right"></i>`
                    }
                </div>
                <div class="content">
                    ${
                      item.role == "assistant"
                        ? markdown.render(item.content)
                        : format(item.content)
                    }
                </div>
            </div>
        `;
  }

  document.querySelectorAll(`code`).forEach((el) => {
    hljs.highlightElement(el);
  });

  message_box.scrollTo({ top: message_box.scrollHeight, behavior: "smooth" });

  setTimeout(() => {
    message_box.scrollTop = message_box.scrollHeight;
  }, 500);
};

const get_conversation = async (conversation_id) => {
  let conversation = await JSON.parse(
    localStorage.getItem(`conversation:${conversation_id}`)
  );
  return conversation.items;
};

const add_conversation = async (conversation_id, title) => {
  if (localStorage.getItem(`conversation:${conversation_id}`) == null) {
    localStorage.setItem(
      `conversation:${conversation_id}`,
      JSON.stringify({
        id: conversation_id,
        title: title,
        items: [],
        updatedAt: Date.now(),
      })
    );
  }
};

const add_message = async (conversation_id, role, content) => {
  const before_adding = JSON.parse(
    localStorage.getItem(`conversation:${conversation_id}`)
  );

  before_adding.items.push({
    role: role,
    content: content,
  });
  before_adding.updatedAt = Date.now();

  localStorage.setItem(
    `conversation:${conversation_id}`,
    JSON.stringify(before_adding)
  ); // update conversation
};

const load_conversations = async (limit, offset, loader) => {
  const conversations = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("conversation:")) {
      const conversation = localStorage.getItem(key);
      conversations.push(JSON.parse(conversation));
    }
  }

  conversations.sort((left, right) => {
    const leftTime = left.updatedAt || 0;
    const rightTime = right.updatedAt || 0;
    return rightTime - leftTime;
  });
  await clear_conversations();

  document.getElementById("history-count").textContent = conversations.length;
  for (const conversation of conversations) {
    box_conversations.innerHTML += `
    <div class="convo ${conversation.id === window.conversation_id ? "active" : ""}" id="convo-${conversation.id}">
      <div class="left" onclick="set_conversation('${conversation.id}')">
          <i class="fa-regular fa-comments"></i>
          <span class="convo-title">${escape_html(conversation.title)}</span>
      </div>
      <button type="button" onclick="show_option('${conversation.id}')" aria-label="Delete conversation" id="conv-${conversation.id}"><i class="fa-regular fa-trash"></i></button>
      <button type="button" onclick="delete_conversation('${conversation.id}')" aria-label="Confirm delete" id="yes-${conversation.id}" style="display:none;"><i class="fa-regular fa-check"></i></button>
      <button type="button" onclick="hide_option('${conversation.id}')" aria-label="Cancel delete" id="not-${conversation.id}" style="display:none;"><i class="fa-regular fa-x"></i></button>
    </div>
    `;
  }

  filter_conversations(document.getElementById("conversation-search").value);
};

document.getElementById(`cancelButton`).addEventListener(`click`, async () => {
  window.controller.abort();
  console.log(`aborted ${window.conversation_id}`);
});

function h2a(str1) {
  var hex = str1.toString();
  var str = "";

  for (var n = 0; n < hex.length; n += 2) {
    str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
  }

  return str;
}

const uuid = () => {
  return `xxxxxxxx-xxxx-4xxx-yxxx-${Date.now().toString(16)}`.replace(
    /[xy]/g,
    function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
};

const message_id = () => {
  const random_bytes = (Math.floor(Math.random() * 1338377565) + 2956589730).toString(
    2
  );
  const unix = Math.floor(Date.now() / 1000).toString(2);

  return BigInt(`0b${unix}${random_bytes}`).toString();
};

window.onload = async () => {
  load_settings_localstorage();

  await setTimeout(() => {
    load_conversations(20, 0);
  }, 1);

  if (!window.location.href.endsWith(`#`)) {
    if (/\/chat\/.+/.test(window.location.href)) {
      await load_conversation(window.conversation_id);
    }
  }

message_input.addEventListener(`keydown`, async (evt) => {
    if (prompt_lock) return;
    if (evt.keyCode === 13 && !evt.shiftKey) {
        evt.preventDefault();
        console.log('pressed enter');
        await handle_ask();
    } else {
      message_input.style.removeProperty("height");
      message_input.style.height = message_input.scrollHeight + 4 + "px";
    }
  });

  send_button.addEventListener(`click`, async () => {
    if (prompt_lock) return;
    await handle_ask();
  });

  register_settings_localstorage();
};

const toggle_sidebar = (show) => {
  const sidebar = document.querySelector(".conversations");
  const shouldShow = show === undefined ? !sidebar.classList.contains("shown") : show;
  sidebar.classList.toggle("shown", shouldShow);
};

const filter_conversations = (query) => {
  const normalizedQuery = query.trim().toLowerCase();
  document.querySelectorAll(".conversation-list .convo").forEach((conversation) => {
    const title = conversation.querySelector(".convo-title").textContent.toLowerCase();
    conversation.hidden = !title.includes(normalizedQuery);
  });
};

const use_prompt = (prompt) => {
  message_input.value = prompt;
  resizeTextarea(message_input);
  message_input.focus();
  message_input.setSelectionRange(prompt.length, prompt.length);
};

const export_conversation = () => {
  const storedConversation = localStorage.getItem(`conversation:${window.conversation_id}`);
  if (!storedConversation) {
    window.alert("There are no messages to export yet.");
    return;
  }

  const conversation = JSON.parse(storedConversation);
  const markdownText = conversation.items
    .map((item) => `## ${item.role === "assistant" ? "Assistant" : "You"}\n\n${item.content}`)
    .join("\n\n---\n\n");
  const fileName = (conversation.title || "orbit-conversation")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "orbit-conversation";
  const download = document.createElement("a");
  const file = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(file);

  download.href = url;
  download.download = `${fileName}.md`;
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

document.getElementById("conversation-search").addEventListener("input", (event) => {
  filter_conversations(event.target.value);
});

document.addEventListener("keydown", (event) => {
  const isTyping = event.target.matches("input, textarea, select");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    new_conversation();
  } else if (event.key === "/" && !isTyping) {
    event.preventDefault();
    document.getElementById("conversation-search").focus();
  } else if (event.key === "Escape") {
    toggle_sidebar(false);
  }
});

const register_settings_localstorage = async () => {
  const settings_ids = ["switch", "model", "jailbreak"];
  const settings_elements = settings_ids.map((id) => document.getElementById(id));
  settings_elements.forEach((element) =>
    element.addEventListener(`change`, async (event) => {
      switch (event.target.type) {
        case "checkbox":
          localStorage.setItem(event.target.id, event.target.checked);
          break;
        case "select-one":
          localStorage.setItem(event.target.id, event.target.selectedIndex);
          break;
        default:
          console.warn("Unresolved element type");
      }
    })
  );
};

const load_settings_localstorage = async () => {
  const settings_ids = ["switch", "model", "jailbreak"];
  const settings_elements = settings_ids.map((id) => document.getElementById(id));
  settings_elements.forEach((element) => {
    if (localStorage.getItem(element.id)) {
      switch (element.type) {
        case "checkbox":
          element.checked = localStorage.getItem(element.id) === "true";
          break;
        case "select-one":
          element.selectedIndex = parseInt(localStorage.getItem(element.id));
          break;
        default:
          console.warn("Unresolved element type");
      }
    }
  });
};

const themePicker = document.getElementById("theme-select");
const setTheme = (theme) => {
  const supportedThemes = ["dark", "light", "blue", "green", "pink"];
  const activeTheme = supportedThemes.includes(theme) ? theme : "dark";
  themePicker.value = activeTheme;
  document.documentElement.dataset.theme = activeTheme;
  localStorage.setItem("theme", activeTheme);
};

setTheme(localStorage.getItem("theme"));
themePicker.addEventListener("change", (event) => setTheme(event.target.value));
