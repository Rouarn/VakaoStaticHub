import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import 'uno.css';
import App from './App.vue';
import router from './router';
import { migrateLegacyStorage } from '@/utils/storage';

// 必须在创建 store 之前完成旧 key 迁移，保证首次读取拿到的就是新 key
migrateLegacyStorage();

const app = createApp(App);

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

app.use(pinia);
app.use(router);

app.mount('#app');
