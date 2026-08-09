export function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value || '');
  return element.innerHTML;
}

export function avatarMarkup(image, name, className = '') {
  const initial = escapeHtml(
    String(name || '?')
      .trim()
      .slice(0, 1)
      .toUpperCase() || '?',
  );
  const source = String(image || '');
  const imageHtml = /^data:image\/(?:jpeg|png|webp);base64,/i.test(source)
    ? `<img src="${source}" alt="" />`
    : `<span aria-hidden="true">${initial}</span>`;
  return `<span class="profile-avatar ${className}">${imageHtml}</span>`;
}

export function prepareProfileImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/') || file.size > 15 * 1024 * 1024) return reject(new Error('invalid_image'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('image_read_failed'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('image_decode_failed'));
      image.onload = () => {
        const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        context.fillStyle = '#111827';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/jpeg', 0.82);
        if (result.length > 700_000) return reject(new Error('image_too_large'));
        resolve(result);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function formatFeatureText(value) {
  let formatted = escapeHtml(value);
  formatted = formatted.replace(
    /\[(?:color|kolor)=(#[0-9a-f]{3}(?:[0-9a-f]{3})?|red|orange|yellow|green|blue|purple|pink|white|gray|grey|gold|cyan)\]([\s\S]*?)\[\/(?:color|kolor)\]/gi,
    (_match, color, content) => `<span style="color: ${color}">${content}</span>`,
  );
  formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return formatted.replace(/\r?\n/g, '<br>');
}
