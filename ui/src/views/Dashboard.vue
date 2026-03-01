<script setup lang="ts">
import TorrentList from '../components/TorrentList.vue';
import StatusBar from '../components/StatusBar.vue';
import EventLog from '../components/EventLog.vue';
</script>

<template>
  <div class="space-y-6">
    <StatusBar />
    <TorrentList />
    <EventLog />
  </div>
</template>
