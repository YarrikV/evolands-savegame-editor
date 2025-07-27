import { Serializer, Unserializer } from 'https://cdn.jsdelivr.net/npm/haxeformat@1.3.1/+esm'

async function sha1(source) {
  const sourceBytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-1", sourceBytes);
  const resultBytes = [...new Uint8Array(digest)];
  return resultBytes.map(x => x.toString(16).padStart(2, '0')).join("");
}

async function makeCRC(string) {
  const SALT = 's*al!t'
  let crc = await sha1(string + SALT)
  crc = await sha1(string + crc)
  return crc.substring(4, 4+32)
}

function normalizeObject(obj) {
  if (typeof obj !== 'object') return obj
  if (obj === null) return obj

  const isArray = Array.isArray(obj)
  const keys = Object.getOwnPropertyNames(obj)
  const result = isArray ? [] : {}

  for (const key of keys) {
    if (isArray && key === 'length') continue

    const value = obj[key]
    result[key] = typeof value === 'object' ? normalizeObject(value) : value
  }

  return result
}

async function unserialize(text) {
  const [_, serialized, _checksum] = text.match(/^(.*)(#[a-f0-9]{32}|[a-f0-9]{40})$/)
  const unserializer = new Unserializer(serialized)
  unserializer.useEnumIndex = false;
  unserializer.allowUnregistered = true;
  unserializer.addTypeHints = true;
  const data = normalizeObject(unserializer.unserialize())

  return data
}


/** Return reference value for cache usage of serialized string. 
 * 
 * if y4:args is the X th y123:abc in the object, 
 * it can be reused as R(X-1), instead of writing y4:args again.
 * 
 * Returns negative number if not found.
*/
function getHaxeReferenceNumber(serialized, keys) {
  const results = Object.fromEntries(keys.map(key => [key, -1]));

  let i = 0
  let stringCounter=0;
  const stringMatch = /^y(\d+):/
  while (i < serialized.length) {
    if (serialized[i] === 'y') {
      let match = stringMatch.exec(serialized.slice(i));

      // check if string matched
      if (match) {
        
        const length = parseInt(match[1]);
        const matchLength = match[0].length
        const stringValue = serialized.substr(i+matchLength, length)
        
        // check if a key is matched
        for (const key of keys) {
          if (stringValue === key) {
            results[key] = stringCounter
            keys.splice(keys.indexOf(key), 1);
          }
        }

        stringCounter++;
        i += matchLength + length
        continue;
      }
    }
    i++;
  }
  return results
}

/**
 * Converts objects in a haxe serialized string to their enum instances.
 * 
 * Objects that can be converted must have properties:
 * - __enum_name
 * - __enum_tag
 * 
 * Support limited for enums with no args. 
 * These objects have property:
 * - argsah: empty array of args.
 * 
 * @see https://haxe.org/manual/std-serialization-format.html
 */
function handleHaxeEnums(serialized) {
  // check first appearance of enum name and enum tag:
  const enumRefNumbers = getHaxeReferenceNumber(serialized, ["args", "__enum_name", "__enum_tag"]);

  // match Haxe object: start with o, and with g
  // limited to 0 args enums: "y4:argsah"
  const enumPattern = `o(y4:args|R${enumRefNumbers.args})ah(y11:__enum_name|R${enumRefNumbers.__enum_name})(y\\d+:[A-Za-z0-9_.]*?|R\\d+)(y10:__enum_tag|R${enumRefNumbers.__enum_tag})(y\\d+:[A-Za-z0-9_.]|R\\d+)g`
  const enumRegex = new RegExp(enumPattern, "g");
  return serialized.replace(enumRegex, "w$3$5:0"); 
}

async function serialize(data) {
  const serializer = new Serializer()
  serializer.useEnumIndex = false;
  serializer.allowUnregistered = true;
  serializer.addTypeHints = true;
  serializer.serialize(data)
  let serialized = serializer.toString()
  
  serialized = handleHaxeEnums(serialized)
  const checksum = await makeCRC(serialized)
  return serialized + '#' + checksum
}

async function startSave(data) {
  const savegames = []

  // Evolands 1 (base game)
  savegames.push({
    label: 'Evoland 1 (Base game)',
    disabled: true
  })

  // Evolands 2 (base game)
  savegames.push({
    label: 'Evoland 2 (Base game)',
    disabled: true
  })

  // Evolands 1 (Legendary edition)
  savegames.push({
    label: 'Evoland 1 (Legendary edition)',
    content: await serialize({
      data: data.data || data,
      game: { args: [], __enum_name: 'GameType', ...data.game, __enum_tag: 'Evo1' },
      time: data.time || Date.now()
    })
  })

  // Evolands 2 (Legendary edition)
  savegames.push({
    label: 'Evoland 2 (Legendary edition)',
    content: await serialize({
      data: data.data || data,
      game: { args: [], __enum_name: 'GameType', ...data.game, __enum_tag: 'Evo2' },
      time: data.time || Date.now()
    })
  })

  for (const { content, disabled, label } of savegames) {
    const link = document.createElement('a')
    link.innerText = 'Download savegame | ' + label
    link.download = 'savegame'

    Object.assign(link.style, {
      marginBottom: '.5rem'
    })

    if (!disabled) {
      const file = new Blob([content], { type: 'text/plain' })
      link.href = URL.createObjectURL(file)
    } else {
      link.style.textDecoration = 'line-through'
    }

    document.body.appendChild(link)
  }
}

async function startEditor(data) {
  const options = {
    mode: 'code'
  }
  const container = document.createElement('div')
  Object.assign(container.style, {
    width: '100%',
    flexGrow: 1
  })

  const editor = new JSONEditor(container, options)
  editor.set(data)

  document.body.appendChild(container)

  const saveBtn = document.createElement('button')
  saveBtn.innerHTML = 'Save'
  Object.assign(saveBtn.style, {
    width: '100%',
    marginTop: '1rem'
  })

  saveBtn.onclick = () => {
    container.remove()
    saveBtn.remove()
    startSave(editor.get())
  }

  document.body.appendChild(saveBtn)
}

async function loadSavegame(text) {
  const data = await unserialize(text)
  await startEditor(data)
}

function init() {
  const loadButton = document.createElement('button')
  loadButton.innerText = 'Load savegame'
  document.body.appendChild(loadButton)
  
  loadButton.onclick = () => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
  
    fileInput.onchange = async e => {
      if (e.target.files[0]) {
        const text = await e.target.files[0].text()
        
        try {
          await loadSavegame(text)
        } catch (err) {
          console.error(err)
          alert("Failed loading savegame!")
          location.reload()
        }
      }
  
      fileInput.remove()
      loadButton.remove()
    }
  
    fileInput.click()
  }
}

init()
